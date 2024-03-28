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
		this.init().then(response => console.log(response));
	}
	async init() {
		try {
			const urls = await this.getUrlsFromSitemap(this.sitemapUrl);
			const images = await this.getImageSources(urls);
			const compressedImages = await this.compressImages(images);
			for (const image of compressedImages) {
				await this.uploadFile(this.domainCode, image);
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
			} else {
				return baseUrl + '/' + relativePath;
			}
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
	async compressImages (images) {
		const encodedKey = Buffer.from(`api:${TINIFY_API_KEY}`).toString('base64');
		const options = {
			hostname: 'api.tinify.com',
			port: 443,
			path: '/shrink',
			method: 'POST',
			headers: {
				'Authorization': `Basic ${encodedKey}`,
				'Content-Type': 'application/json'
			}
		};

		let compressedImages = [];

		const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

		for(const image of images) {
			const imageUrl = image.url;
			try {

				let result = new Promise((resolve, reject) => {
					const req = https.request(options, (res) => {
						let body = '';
						res.on('data', (chunk) => body += chunk);
						res.on('end', () => resolve(JSON.parse(body)));
					});
					req.on('error', (e) => reject(e));
					req.write(JSON.stringify({source: {url: imageUrl}}));
					req.end();
				});

				result = await result;
				compressedImages.push({
					input: {
						url: imageUrl,
						size: result.input.size,
						type: result.input.type,
						title: image.title,
						alt: image.alt,
						width: image.width,
						height: image.height,
						loading: image.loading,
					},
					output: {
						url: result.output.url,
						size: result.output.size,
						type: result.output.type,
					},
					info: {
						saved_bytes: result.input.size - result.output.size,
						saved_percent: 100 - (result.output.ratio * 100),
						image_path: image.path,
						image_width: result.output.width,
						image_height: result.output.height,
					},
				});

				await delay(1000);

			} catch(error) {
				console.error(`Error compressing image ${imageUrl}:`, error);
			}
		}
		return compressedImages;
	}
	async uploadFile(domainCode, compressedImage) {

		try {

			// fetch original image
			const originalImageUrl = compressedImage.input.url; // Assuming this is the compressed image URL
			const originalImageUrlResponse = await fetch(originalImageUrl);
			if (!originalImageUrlResponse.ok) console.error(`Failed to fetch ${originalImageUrl}: ${originalImageUrlResponse.statusText}`);
			const originalImageUrlResponseBuffer = await originalImageUrlResponse.buffer();
			const originalImageContent = originalImageUrlResponseBuffer.toString('base64');

			// fetch newly compressed image
			const imageUrl = compressedImage.output.url; // Assuming this is the compressed image URL
			const imageResponse = await fetch(imageUrl);
			if (!imageResponse.ok) console.error(`Failed to fetch ${imageUrl}: ${imageResponse.statusText}`);
			const imageBuffer = await imageResponse.buffer();
			const content = imageBuffer.toString('base64');

			let imagePath = compressedImage.info.image_path === '/' ? '/_home/' : compressedImage.info.image_path;
			const imageFileName = imageUrl.replace('https://api.tinify.com/output/', ''); // Sanitize filename

			// clean for client-facing & encode the json to base64
			function millisecondsSaved(byteSize, connectionSpeed) {

				// Convert connection speed from Mbps to bytes per second
				const speedBytesPerSecond = connectionSpeed * 125000; // 1 byte = 8 bits, 1 Mbps = 1,000,000 bits/s

				// Calculate download time in seconds
				const result = byteSize / speedBytesPerSecond * 1000;
				return Number(result.toFixed(0));
			}

			const archive_folder = `https://github.com/JakeLabate/Hooray-SEO-Compress/blob/main/domains/${domainCode}${imagePath}${imageFileName}`;
			const json = {
				original_image: {
					website_file: compressedImage.input.url,
					archive_file: `${archive_folder}/image-original.png`,
					size: compressedImage.input.size,
					type: compressedImage.input.type,
					attributes: {
						title: compressedImage.input.title,
						alt: compressedImage.input.alt,
						width: compressedImage.input.width,
						height: compressedImage.input.height,
						loading: compressedImage.input.loading
					}
				},
				compressed_image: {
					archive_file: `${archive_folder}/image-compressed.png`,
					size: compressedImage.output.size,
					type: compressedImage.output.type,
					attributes: {
						title: '',
						alt: '',
						width: '',
						height: '',
						loading: ''
					}
				},
				info: {
					archive_folder,
					saved_bytes: compressedImage.info.saved_bytes,
					saved_percent: compressedImage.info.saved_percent,
					saved_milliseconds_per_download_speed: {
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
			}


			// prepare stuff for octokit
			const encodedContent = Buffer.from(JSON.stringify(json, null, 2)).toString('base64');
			const githubOwner = 'JakeLabate';
			const githubEmail = 'jake.a.labate@gmail.com';
			const githubRepo = 'AA-Images';
			const githubPath = `domains/${domainCode}${imagePath}${imageFileName}`;

			// Function to check if the file exists and get its SHA (if it does)
			const getFileSha = async (filePath) => {
				try {
					const { data } = await octokit.repos.getContent({
						owner: githubOwner,
						repo: githubRepo,
						path: `${githubPath}/${filePath}`
					});
					return data['sha']; // Return the SHA of the existing file
				} catch (error) {
					if (error.status !== 404) {
						console.error('Error fetching file SHA:', error);
					}
					return null;
				}
			};

			// upload original image
			const originalPath = 'image-original.png';
			let sha = await getFileSha(originalPath);
			await octokit.repos.createOrUpdateFileContents({
				owner: githubOwner,
				repo: githubRepo,
				path: `${githubPath}/${originalPath}`,
				message: `Original image`,
				content: originalImageContent,
				sha,
				committer: {
					name: githubOwner,
					email: githubEmail
				},
				author: {
					name: githubOwner,
					email: githubEmail
				},
			});

			// upload newly compressed image
			const compressionPath = 'image-compressed.png';
			sha = await getFileSha(compressionPath);
			await octokit.repos.createOrUpdateFileContents({
				owner: githubOwner,
				repo: githubRepo,
				path: `${githubPath}/${compressionPath}`,
				message: `Compressed image`,
				content,
				sha,
				committer: {
					name: githubOwner,
					email: githubEmail
				},
				author: {
					name: githubOwner,
					email: githubEmail
				},
			});

			// upload json compression data
			const jsonDataPath = 'data.js'
			sha = await getFileSha(jsonDataPath);
			await octokit.repos.createOrUpdateFileContents({
				owner: githubOwner,
				repo: githubRepo,
				path: `${githubPath}/${jsonDataPath}`,
				message: `Data`,
				content: encodedContent,
				sha,
				committer: {
					name: githubOwner,
					email: githubEmail
				},
				author: {
					name: githubOwner,
					email: githubEmail
				},
			});

			console.log(`Upload success to ${archive_folder}`);
		} catch (error) {
			console.error(`Error uploading ${compressedImage.output.url}:`, error.message);
		}
	}
}

new CompressImages({
	domainCode: 'espaciowaikiki',
	sitemapUrl: 'https://www.espaciowaikiki.com/page-sitemap.xml',
	maxImages: 20
})