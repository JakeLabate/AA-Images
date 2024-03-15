import {Octokit} from '@octokit/rest';
import fs from 'fs';
import path from 'path';

// Initialize Octokit with your GitHub token
const octokit = new Octokit({
	auth: '',
});

const owner = 'JakeLabate';
const repo = 'your_repo_name';
const folderPath = 'path_to_your_local_images_folder';

// Function to upload a single file
async function uploadFile(filePath) {
	const content = fs.readFileSync(filePath, 'base64');
	const fileName = path.basename(filePath);
	const githubPath = `folder_in_your_repo/${fileName}`; // Adjust the folder path as needed

	try {
		const response = await octokit.repos.createOrUpdateFileContents({
			owner,
			repo,
			path: githubPath,
			message: `Add ${fileName}`,
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

		console.log(`Successfully uploaded ${fileName}: ${response.data.content.html_url}`);
	} catch (error) {
		console.error(`Error uploading ${fileName}: ${error}`);
	}
}

// Example usage
fs.readdir(folderPath, (err, files) => {

	if (err) return console.error(`Unable to scan directory: ${err}`);
	files.forEach(file => {
		uploadFile(path.join(folderPath, file)).then(r => console.log(r));
	});
});


