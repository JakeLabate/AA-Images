import { Octokit } from '@octokit/rest';
import fs from 'fs';
import path from 'path';

import fetch from 'node-fetch';
import https from 'https';
import xml2js from 'xml2js';
import cheerio from 'cheerio';

// Initialize Octokit with your GitHub token
const octokit = new Octokit({
	auth: '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',
});

async function getUrlsFromSitemap(sitemap) {
	const response = await fetch(sitemap);
	const data = await response.text();

	const parser = new xml2js.Parser();
	const parsedData = await parser.parseStringPromise(data);
	return parsedData.urlset.url.map(urlEntry => urlEntry.loc[0].trim());
}

async function getImageSources(urls) {

	let images = {};

	for (const url of urls) {
		try {

			const response = await fetch(url);
			const html = await response.text();
			const $ = cheerio.load(html);

			// Add all image sources to the images array
			const pathName = new URL(url).pathname;
			images[pathName] = [];

			$('img').each((index, element) => {
				const src = $(element).attr('src');
				const alt = $(element).attr('alt');
				const title = $(element).attr('title');
				const loading = $(element).attr('loading');
				if (src) {

					images[pathName].push({
						src: new URL(src, url).href,
						alt: alt || null,
						title: title || null,
						loading: loading || null,
						path: pathName === '/' ? '/_' : pathName,
					});

				}
			});

		} catch (error) {
			console.error(`Error fetching images from ${url}:`, error.message);
		}
	}

	return images;
}

async function compressImages(json, maxImages) {

	let imageArrayOfObjects = Object.keys(json).map(key => json[key]).flat();
	imageArrayOfObjects = imageArrayOfObjects.slice(0, Number(maxImages));

	const apiKey = '9rrbS2tc5582vwJvFsqyLFgXJZzDphML';
	const encodedKey = Buffer.from(`api:${apiKey}`).toString('base64');
	const options = {
		hostname: 'api.tinify.com',
		port: 443,
		path: '/shrink',
		method: 'POST',
		headers: {
			'Authorization': 'Basic ' + encodedKey,
			'Content-Type': 'application/json',
		}
	};

	return await Promise.all(imageArrayOfObjects.map(async (image) => {

		const data = JSON.stringify({
			"source": {
				"url": image.src
			}
		});

		const req = https.request(options, (res) => {
			console.log(`StatusCode: ${res.statusCode}`);
			res.on('data', (d) => {
				process.stdout.write(d);
			});
		});

		req.on('error', (error) => {
			console.error(error);
		});

		req.write(data);
		req.end();

		let response = new Promise((resolve, reject) => {
			req.on('response', (res) => {
				let body = '';
				res.on('data', (chunk) => {
					body += chunk;
				});
				res.on('end', () => {
					resolve(JSON.parse(body));
				});
			});

		});

		response = await response;
		return {
			...response,
			input: {
				...response.input,
				...image,
			}
		};

	}))

}

// Function to upload a single file
async function uploadFile(domainCode, filePath) {
	console.log(domainCode + ' ' + filePath);
	const content = fs.readFileSync(filePath, 'base64');

	domainCode = path.basename(filePath);
	const githubPath = `domains/${domainCode}`; // Adjust the folder path as needed

	try {
		const response = await octokit.repos.createOrUpdateFileContents({
			owner: 'Jake Labate',
			repo: 'AA-Images',
			path: githubPath,
			message: `Add ${filePath}`,
			content: content,
			committer: {
				name: `Jake Labate`,
				email: `jake.a.labate@gmail.com`,
			},
			author: {
				name: `Jake Labate`,
				email: `jake.a.labate@gmail.com`,
			},
		});

		console.log(`Successfully uploaded ${filePath}: ${response.data.content.html_url}`);
	} catch (error) {
		console.error(`Error uploading ${filePath}: ${error}`);
	}
}

async function run({sitemapUrl, maxImages}) {

	const urls = await getUrlsFromSitemap(sitemapUrl);
	const json = await getImageSources(urls);
	const compressedJson = await compressImages(json, maxImages);

	for (const image of compressedJson) {

		const folderPath = image.input.path === '/_' ? '/home' : image.input.path;
		fs.readdir(folderPath, (err, files) => {
			if (err) return console.error(`Unable to scan directory: ${err}`);
			files.forEach(file => {
				uploadFile(path.join(folderPath, file)).then(r => console.log(r));
			});
		});
	}

}

run({
	domainCode: 'espaciowaikiki',
	sitemapUrl: 'https://www.jakelabate.com/sitemap.xml',
	maxImages: 2
});