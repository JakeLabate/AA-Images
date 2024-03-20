import { Octokit } from '@octokit/rest';
import fetch from 'node-fetch';
import https from 'https';
import xml2js from 'xml2js';
import cheerio from 'cheerio';
import dotenv from 'dotenv';

dotenv.config();

const octokit = new Octokit({
	auth: process.env.GITHUB_PAT,
});

class CompressImages {
	constructor({ domainCode, sitemapUrl, maxImages }) {
		this.domainCode = domainCode;
		this.sitemapUrl = sitemapUrl;
		this.maxImages = maxImages;
		this.init();
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
		return parsedData.urlset.url.map(urlEntry => urlEntry.loc[0].trim());
	}
	async getImageSources(urls) {
		const baseUrl = new URL(this.sitemapUrl).origin;

		let images = [];
		for (const url of urls.slice(0, this.maxImages)) { // Limit to maxImages for demonstration
			try {
				const response = await fetch(url);
				const html = await response.text();
				const $ = cheerio.load(html);
				$('img').each((_, element) => {

					const src = $(element).attr('src');

					function formatUrl(relativePath) {

						if (relativePath.startsWith('/wp-content')) {
							return baseUrl + relativePath;
						} else if (relativePath.startsWith('/')) {
							return baseUrl + relativePath;
						} else if (relativePath.startsWith('http')) {
							return relativePath;
						} else {
							return baseUrl + '/' + relativePath;
						}
					}

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
		const apiKey = process.env.TINIFY_API_KEY;
		const encodedKey = Buffer.from(`api:${apiKey}`).toString('base64');
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
						saved_percent: 100 - (result.output.ratio * 100) + '%',
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

			const imageUrl = compressedImage.output.url; // Assuming this is the compressed image URL

			const imageResponse = await fetch(imageUrl);
			if (!imageResponse.ok) throw new Error(`Failed to fetch ${imageUrl}: ${imageResponse.statusText}`);

			const imageBuffer = await imageResponse.buffer();
			const content = imageBuffer.toString('base64');

			const imagePath = compressedImage.info.image_path === '/' ? '/_' : compressedImage.info.image_path;
			const imageName = imageUrl.replace(/[^a-zA-Z0-9._-]/g, '_'); // Sanitize filename
			const github = {
				owner: 'JakeLabate',
				repo: 'AA-Images',
				path: `domains/${domainCode}${imagePath}${imageName}.png`
			};

			// Function to check if the file exists and get its SHA (if it does)
			const getFileSha = async () => {
				try {
					const { data } = await octokit.repos.getContent({ ...github});
					return data.sha; // Return the SHA of the existing file
				} catch (error) {
					if (error.status !== 404) {
						console.error('Error fetching file SHA:', error);
					}
					return null;
				}
			};

			const sha = await getFileSha();
			const response = await octokit.repos.createOrUpdateFileContents({
				...github,
				message: `Add compressed image for ${domainCode}`,
				content,
				sha,
				committer: {
					name: github.owner,
					email: 'jake.a.labate@gmail.com'
				},
				author: {
					name: github.owner,
					email: 'jake.a.labate@gmail.com'
				},
			});

			console.log(`Successfully uploaded ${imageName}: ${response.data.content.html_url}`);
		} catch (error) {
			console.error(`Error uploading ${compressedImage.output.url}:`, error.message);
		}
	}
}

new CompressImages({
	domainCode: 'espaciowaikiki',
	sitemapUrl: 'https://www.espaciowaikiki.com/page-sitemap.xml',
	maxImages: 10
});