const axios = require("axios");
const { parseStringPromise } = require("xml2js");
const { createObjectCsvWriter } = require("csv-writer");
const fs = require("fs");

// Replace with the proper values
// const ENVIRONMENT = "your-environment";
// const API_KEY = "your-apikey";
const ENVIRONMENT = "your environment";
const API_KEY = "your api key";
const baseFolderUrl = `https://${ENVIRONMENT}.chili-publish.online/rest-api/v1.2/resources/Assets/treelevel`;
const baseFileUrl = `https://${ENVIRONMENT}.chili-publish.online/rest-api/v1.2/resources/Assets/sorted`;

// State file to save progress
const STATE_FILE = "state.json";

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// CSV Writer setup
const csvWriter = createObjectCsvWriter({
  path: "output.csv",
  header: [
    { id: "name", title: "Name" },
    { id: "id", title: "ID" },
    { id: "relativePath", title: "Relative Path" },
    { id: "fileSize", title: "File Size" },
  ],
});

/**
 * Save the current state (queue and discovered files) to a file
 * @param {Array} queue The current exploration queue
 * @param {Array} allFiles The list of discovered files so far
 */
function saveState(queue, allFiles, currentPage) {
  const state = {
    queue,
    allFiles,
    currentPage
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  console.log("State saved!");
}

/**
 * Load the last saved state from the state file
 * @returns {Object} The loaded state { queue, allFiles }
 */
function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    console.log("State loaded!");
    return state;
  }
  return { queue: [""], allFiles: [], currentPage: 1 }; // Default initial state
}

/**
 * Fetch subfolders from a given folder path
 * @param {string} currentPath The path to query
 * @returns {Promise<Array>} List of discovered subfolder IDs
 */
async function fetchSubfolders(currentPath) {
  const url = `${baseFolderUrl}?parentFolder=${encodeURIComponent(currentPath)}&numLevels=1&includeSubDirectories=true&includeFiles=false`;
  console.log(`Requesting subfolders: ${url}`);
  const response = await axios.get(url, { headers: { "api-key": API_KEY } });

  // Parse the XML response
  const result = await parseStringPromise(response.data);

  const tree = result.tree?.item || [];
  const subfolders = tree
    .filter((item) => item.$.isFolder === "true")
    .map((item) => item.$.id);

  return subfolders;
}

/**
 * Fetch files from a given folder, paginating if necessary
 * @param {string} currentPath The path to query
 * @returns {Promise<Array>} List of file objects { name, id, relativePath, fileSize }
 */
// async function fetchFiles(currentPath, allFiles) {
//   const files = [];
//   let currentPage = 1;
//
//   while (true) {
//     const url = `${baseFileUrl}?parentFolderPath=${encodeURIComponent(
//       currentPath
//     )}&includeSubDirectories=false&pageSize=100&pageNum=${currentPage}`;
//     console.log(`Requesting files: ${url}`);
//     const response = await axios.get(url, { headers: { "api-key": API_KEY } });
//
//     // Parse the XML response
//     const result = await parseStringPromise(response.data);
//     const searchResults = result.searchresults || {};
//     const items = searchResults.item || [];
//
//     // Extract file information
//     for (const item of items) {
//       files.push({
//         name: item.$.name,
//         id: item.$.id,
//         relativePath: item.$.relativePath,
//         fileSize: item.fileInfo[0].$.fileSize,
//       });
//     }
//
//     // Check if we need to paginate
//     const numPages = parseInt(searchResults.$.numPages, 10);
//     if (currentPage >= numPages) break;
//
//     currentPage++;
//   }
//
//   return files;
// }

async function fetchFilesOnPage(currentPath, currentPage) {
  const files = [];

  const url = `${baseFileUrl}?parentFolderPath=${encodeURIComponent(
    currentPath
  )}&includeSubDirectories=false&pageSize=100&pageNum=${currentPage}`;
  console.log(`Requesting files: ${url}`);
  const response = await axios.get(url, { headers: { "api-key": API_KEY } });

  // Parse the XML response
  const result = await parseStringPromise(response.data);
  const searchResults = result.searchresults || {};
  const items = searchResults.item || [];

  // Extract file information
  for (const item of items) {
    files.push({
      name: item.$.name,
      id: item.$.id,
      relativePath: item.$.relativePath,
      fileSize: item.fileInfo[0].$.fileSize,
    });
  }

  // Check if we need to paginate
  const numPages = parseInt(searchResults.$.numPages, 10);
  if (currentPage >= numPages) {
    return {
      files,
      nextPage: null
    }
  }
  else {
    return {
      files,
      nextPage: currentPage + 1
    }
  }
}



/**
 * Explore all folders and retrieve files iteratively, while maintaining state
 */
async function exploreAndFetchFiles() {
  // Load saved state or initialize a new state
  let { queue, allFiles, currentPage } = loadState();

  while (queue.length > 0) {
    const currentPath = queue[0]; // Get the next path from the queue
    console.log(`Exploring path: ${currentPath}`);

    try {

      // Fetch files in the current folder
      let nextPage = currentPage ?? 1;

      while (nextPage != null) {
        const { files, nextPage: newNextPage } = await fetchFilesOnPage(currentPath, nextPage);
        nextPage = newNextPage;
        allFiles.push(...files);
        saveState(queue, allFiles, nextPage);
        await delay();
      }

      queue.shift();

      // Save progress after every successful iteration
      saveState(queue, allFiles, 1);
    } catch (error) {
      console.error(
        `Error occurred while processing path '${currentPath}':`,
        error.message
      );
      console.error(
        "Script is crashing to save progress. Run the script again to resume."
      );
      // saveState(queue, allFiles); // Save progress before exiting
      process.exit(1); // Exit with failure
    }
  }

  return allFiles;
}

// Entry point
(async () => {
  try {
    const allFiles = await exploreAndFetchFiles();
    console.log(`Total files discovered: ${allFiles.length}`);

    // Write files to CSV
    await csvWriter.writeRecords(allFiles);
    console.log("CSV file has been written successfully!");

    // Remove the state file after successful completion
    // fs.unlinkSync(STATE_FILE);
    console.log("State file deleted successfully.");
  } catch (error) {
    console.error("Unexpected error:", error.message);
  }
})();
