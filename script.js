import { Octokit } from '@octokit/rest';
import fetch from 'node-fetch';
import https from 'https';
import xml2js from 'xml2js';
import cheerio from 'cheerio';
import dotenv from 'dotenv';

dotenv.config();

const TINIFY_API_KEY = process.env.TINIFY_API_KEY;
const GITHUB_PERSONAL_ACCESS_TOKEN = process.env.GITHUB_PERSONAL_ACCESS_TOKEN

const octokit = new Octokit({
	auth: GITHUB_PERSONAL_ACCESS_TOKEN,
});

class CompressImages {
	constructor({domainCode, sitemapUrl, maxImages}) {
		this.domainCode = domainCode;
		this.sitemapUrl = sitemapUrl;
		this.maxImages = maxImages;
		this.init().then(() => console.log(`finished with ${domainCode}`));
	}
	async init() {
		try {
			const urls = await this.getUrlsFromSitemap(this.sitemapUrl);
			const images = await this.getImageSources(urls);
			const compressedImages = await this.compressImages(images);
			for (const image of compressedImages) {
				await this.upload(this.domainCode, image);
			}
		} catch (error) {
			console.error('Initialization error:', error);
		}
	}
	async getUrlsFromSitemap(sitemap) {
		const response = await fetch(sitemap);
		const data = await response.text();
		const parser = new xml2js.Parser();
		const parsedData = await parser.parseStringPromise(data);
		return parsedData['urlset'].url.map(urlEntry => urlEntry['loc'][0].trim());
	}
	async getImageSources(urls) {

		function formatUrl(relativePath) {
			if (relativePath.startsWith('/')) {
				return baseUrl + relativePath;
			} else if (relativePath.startsWith('http')) {
				return relativePath;
			}
			return baseUrl + '/' + relativePath;
		}

		const baseUrl = new URL(this.sitemapUrl).origin;

		let images = [];
		for (const url of urls.slice(0, this.maxImages)) { // Limit to maxImages for demonstration
			try {

				const response = await fetch(url);
				const html = await response.text();
				const $ = cheerio.load(html);
				$('img').each((_, element) => {

					const src = $(element).attr('src');
					if (src && !src.endsWith('.svg')) { // Skip SVGs
						images.push({
							path: new URL(url).pathname,
							url: formatUrl(src).replace(/\s+/g, '/'), // Remove whitespace
							alt: $(element).attr('alt') || '',
							width: $(element).attr('width') || '',
							height: $(element).attr('height') || '',
							title: $(element).attr('title') || '',
							loading: $(element).attr('loading') || '',
						});
					}
				});
			} catch (error) {
				console.error(`Error fetching images from ${url}:`, error.message);
			}
		}
		return images;
	}
	async compressImages(images) {

		let compressedImages = [];

		for(const image of images) {
			try {

				let result = new Promise((resolve, reject) => {
					const req = https.request({
						hostname: 'api.tinify.com',
						port: 443,
						path: '/shrink',
						method: 'POST',
						headers: {
							'Authorization': `Basic ${Buffer.from(`api:${TINIFY_API_KEY}`).toString('base64')}`,
							'Content-Type': 'application/json'
						}
					}, (res) => {
						let body = '';
						res.on('data', (chunk) => body += chunk);
						res.on('end', () => resolve(JSON.parse(body)));
					});
					req.on('error', (e) => reject(e));
					req.write(JSON.stringify({source: {url: image.url}}));
					req.end();
				});

				result = await result;
				compressedImages.push({
					input: {
						url: image.url,
						size: result.input.size,
						type: result.input.type,
						attributes: {
							title: image.title,
							alt: image.alt,
							width: image.width,
							height: image.height,
							loading: image.loading
						}
					},
					output: {
						url: result.output.url,
						size: result.output.size,
						type: result.output.type,
						attributes: {
							title: image.title,
							alt: image.alt,
							width: image.width,
							height: image.height,
							loading: image.loading
						}
					},
					info: {
						saved_bytes: result.input.size - result.output.size,
						saved_percent: 100 - (result.output.ratio * 100),
						image_path: image.path,
						image_width: result.output.width,
						image_height: result.output.height,
					},
				});

				// throttle requests
				new Promise(resolve => setTimeout(resolve, 1000));

			} catch(error) {
				console.error(`Error compressing image ${image.url}:`, error);
			}
		}

		return compressedImages;
	}
	async upload(domainCode, compressedImage) {

		try {

			const imagePath = compressedImage.info.image_path === '/' ? '/_home/' : compressedImage.info.image_path;
			const imageFileName = compressedImage.output.url.replace('https://api.tinify.com/output/', ''); // Sanitize filename
			const archive_folder = `https://github.com/JakeLabate/Hooray-SEO-Compress/blob/main/domains/${domainCode}${imagePath}${imageFileName}`;

			async function imageToBase64(imageUrl) {
				return new Promise((resolve, reject) => {
					fetch(imageUrl)
					.then(response => response.buffer())
					.then(buffer => resolve(buffer.toString('base64')))
					.catch(error => reject(error));
				});
			}

			async function getFileSha(path) {
				// Function to check if the file exists and get its SHA (if it does)
				try {
					const { data } = await octokit.repos.getContent({
						owner: 'JakeLabate',
						repo: 'AA-Images',
						path: `${archive_folder}/${path}`
					});
					return data['sha']; // Return the SHA of the existing file
				} catch (error) {
					if (error.status !== 404) {
						console.error('Error fetching file SHA:', error);
					}
					return null;
				}
			}

			async function uploadFile({path, content, message}) {
				return await octokit.repos.createOrUpdateFileContents({
					content,
					message,
					owner: 'JakeLabate',
					repo: 'AA-Images',
					path: `domains/${domainCode}${imagePath}${imageFileName}/${path}`,
					sha: await getFileSha(path),
					committer: {
						name: 'JakeLabate',
						email: 'jake.a.labate@gmail.com'
					},
					author: {
						name: 'JakeLabate',
						email: 'jake.a.labate@gmail.com'
					},
				});
			}

			function millisecondsSaved(byteSize, connectionSpeed) { // Convert connection speed from Mbps to bytes per second
				const speedBytesPerSecond = connectionSpeed * 125000; // 1 byte = 8 bits, 1 Mbps = 1,000,000 bits/s
				const result = byteSize / speedBytesPerSecond * 1000; // milliseconds
				return Number(result.toFixed(0));
			}

			function jsonToBase64(json) {
				const jsonString = JSON.stringify(json, null, 2);
				return Buffer.from(jsonString).toString('base64');
			}

			await Promise.all([
				uploadFile({
					path: 'image-original.png',
					content: await imageToBase64(compressedImage.input.url),
					message: 'Original image',
				}),
				uploadFile({
					path: 'image-compressed.png',
					content: await imageToBase64(compressedImage.output.url),
					message: 'Compressed image',
				}),
				uploadFile({
					path: 'data.json',
					content: jsonToBase64({
						original_image: {
							website_file: compressedImage.input.url,
							archive_file: `${archive_folder}/image-original.png`,
							size: compressedImage.input.size,
							type: compressedImage.input.type,
							attributes: compressedImage.input.attributes
						},
						compressed_image: {
							archive_file: `${archive_folder}/image-compressed.png`,
							size: compressedImage.output.size,
							type: compressedImage.output.type,
							attributes: compressedImage.output.attributes
						},
						info: {
							archive_folder,
							saved_bytes: compressedImage.info.saved_bytes,
							saved_percent: compressedImage.info.saved_percent,
							saved_milliseconds: {
								'25_mbps': millisecondsSaved(compressedImage.info.saved_bytes, 25),
								'50_mbps': millisecondsSaved(compressedImage.info.saved_bytes, 50),
								'75_mbps': millisecondsSaved(compressedImage.info.saved_bytes, 75),
								'100_mbps': millisecondsSaved(compressedImage.info.saved_bytes, 100),
								'125_mbps': millisecondsSaved(compressedImage.info.saved_bytes, 125),
								'150_mbps': millisecondsSaved(compressedImage.info.saved_bytes, 150),
							},
							image_width: compressedImage.info.image_width,
							image_height: compressedImage.info.image_height,
						}
					}),
					message: 'Data',
				})
			]);

			console.log(`Upload success to ${archive_folder}`);
		} catch (error) {
			console.error(`Error uploading ${compressedImage.output.url}:`, error.message);
		}
	}
}

new CompressImages({
	domainCode: 'hotelswexan',
	sitemapUrl: 'https://hotelswexan.com/post-sitemap.xml',
})

/*

// astonAtTheWhalerOnKaanapaliBeach
new CompressImages({
	domainCode: 'astonAtTheWhalerOnKaanapaliBeach',
	// https://www.astonwhaler.com/sitemap_index.xml
	// sitemapUrl: 'https://www.astonwhaler.com/post-sitemap.xml',
	sitemapUrl: 'https://www.astonwhaler.com/page-sitemap.xml',
	// sitemapUrl: 'https://www.astonwhaler.com/category-sitemap.xml',
	// sitemapUrl: 'https://www.astonwhaler.com/author-sitemap.xml'
	maxImages: 1
})

// astonKaanapaliShores
new CompressImages({
	domainCode: 'astonKaanapaliShores',
	// https://www.astonkaanapalishoresresort.com/sitemap_index.xml
	sitemapUrl: 'https://www.astonkaanapalishoresresort.com/page-sitemap.xml',
	maxImages: 1
})

// botánikaOsaPeninsula
new CompressImages({
	domainCode: 'botánikaOsaPeninsula',
	// https://botanikaresort.com/sitemap_index.xml
	// sitemapUrl: 'https://botanikaresort.com/post-sitemap.xml',
	sitemapUrl: 'https://botanikaresort.com/page-sitemap.xml',
	maxImages: 1
})

 */

// espacioWaikiki
new CompressImages({
	domainCode: 'espacioWaikiki',
	// https://www.espaciowaikiki.com/sitemap_index.xml
	// sitemapUrl: 'http://www.espaciowaikiki.com/post-sitemap.xml'
	sitemapUrl: 'https://www.espaciowaikiki.com/page-sitemap.xml',
	// sitemapUrl: https://www.espaciowaikiki.com/category-sitemap.xml
	// sitemapUrl: https://www.espaciowaikiki.com/post_tag-sitemap.xml
	// sitemapUrl: https://www.espaciowaikiki.com/author-sitemap.xml
	maxImages: 1
})

// espacioWaikiki_jp
new CompressImages({
	domainCode: 'espacioWaikiki_jp',
	sitemapUrl: 'https://www.espaciowaikiki.jp/sitemap.xml',
	maxImages: 1
})

// ilikaiHotelLuxurySuites
new CompressImages({
	domainCode: 'ilikaiHotelLuxurySuites',
	// https://www.ilikaihotel.com/sitemap_index.xml
	// sitemapUrl: 'https://www.ilikaihotel.com/post-sitemap.xml',
	sitemapUrl: 'https://www.ilikaihotel.com/page-sitemap.xml',
	// sitemapUrl': 'https://www.ilikaihotel.com/category-sitemap.xml',
	// sitemapUrl': 'https://www.ilikaihotel.com/author-sitemap.xml'
	maxImages: 1
})

/*
// mauiKaanapaliVillas // error with sitemap
new CompressImages({
	domainCode: 'mauiKaanapaliVillas',
	// https://www.astonmauikaanapalivillas.com/sitemap_index.xml
	sitemapUrl: '',
	maxImages: 1
})

*/