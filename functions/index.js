// Importing the firebase-functions module
const functions = require("firebase-functions");

// Importing the express module
const express = require("express");

// Creating an instance of express
const app = express();

// Importing modules
const cors = require("cors");
const admin = require('firebase-admin');

const serviceAccount = require("./memoria-1b4d0-firebase-adminsdk-iss1n-d54bf7e349.json")


admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});
// Using cors middleware with the express app
app.use(cors({ origin: true }));

// Getting a reference to the Firestore service
const db = admin.firestore();


function truncateText(text, maxLength = 20) {
    // Check if the length of the text is greater than the maximum length
    if (text.length > maxLength) {
        // If so, truncate the text to the maximum length and append an ellipsis
        return text.substring(0, maxLength) + '...';
    }

    // If the text is shorter than or equal to the maximum length, return the original text
    return text;
}


function applyEffectToCloudinaryImage(image, text) {
    const url = image.secure_url
    // encode the text to be appropriate in a url
    const transformedText = encodeURI(truncateText(text, 20))
    // set the text size to 5% of the image height
    const textSize = Math.round(image.height * 0.05);
    // set the y offset to 1/6 of the image height
    const yOffset = Math.round(image.height / 6)
    // set the effect to apply to the image
    const effect = `/co_rgb:000000,e_colorize:40/co_rgb:DDD9D9,l_text:georgia_${textSize}_italic_normal_left:${transformedText}/fl_layer_apply,g_north,x_-30,y_${yOffset}`;
    // get the index of the /upload in the url
    const splitIndex = url.indexOf("/upload") + "/upload".length
    // insert the effect into the url
    return url.slice(0, splitIndex) + `/${effect}` + url.slice(splitIndex)

}

// Utility Functions
async function getActiveFolder(userId) {
    const userDocument = db.collection('users').doc(userId);
    const user = await userDocument.get();

    // stop execution if user does not exist
    if (!user.exists) return false;

    return user.data().activeFolder
}

async function updatePersonalFolderItemIdx(userId, folderId, incrementValue, setToValue) {
    const folderRef = db.collection('users').doc(userId).collection('folders').doc(folderId);
    if (setToValue !== undefined) {
        await folderRef.update({ activeFolderItemIdx: setToValue });
    } else {
        const folder = await folderRef.get();
        if (!folder.exists) throw new Error('Folder not found');
        await folderRef.update({ activeFolderItemIdx: folder.data().activeFolderItemIdx + incrementValue });
    }
}

async function updateUserActiveFolderItemIdx(userId, incrementValue, setToValue) {
    const userRef = db.collection('users').doc(userId);
    if (setToValue !== undefined) {
        await userRef.update({ 'activeFolder.activeFolderItemIdx': setToValue });
    } else {
        const user = await userRef.get();
        if (!user.exists) throw new Error('User not found');
        await userRef.update({ 'activeFolder.activeFolderItemIdx': user.data().activeFolder.activeFolderItemIdx + incrementValue });
    }
}

async function getFolderItems(userId, folder) {
    let folderItemRef;
    if (folder.category === 'personal') {
        folderItemRef = db.collection('users').doc(userId).collection('folders').doc(folder.id).collection('items');
    } else if (folder.category === 'community') {
        folderItemRef = db.collection('community').doc(folder.id).collection('items');
    }
    if (!folderItemRef) throw new Error('Folder item reference is null');
    const snapshot = await folderItemRef.get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function updateFolderAndActiveFolder(userId, incrementValue, folderId, setToValue) {

    await updateUserActiveFolderItemIdx(userId, incrementValue, setToValue);
    await updatePersonalFolderItemIdx(userId, folderId, incrementValue, setToValue);
}

async function getActiveFolderItemImageURL(userId, activeFolder) {
    try {
        // If the user ID is not found, throw an error
        if (!userId) throw new Error('User Id not found');

        let activeFolderItemIdx = activeFolder?.activeFolderItemIdx

        //Let the user know if there is no active folder
        if (activeFolder === null || activeFolderItemIdx === undefined) {
            console.error('No active folder found');
            return null;
        }

        // If the active folder exists, get the items in the folder
        const folderItems = await getFolderItems(userId, { id: activeFolder.folderId, category: activeFolder.folderCategory });

        //Make the active FolderIdx the first item it it exceeds the folderItems Length
        if (activeFolderItemIdx > folderItems.length - 1) {
            activeFolderItemIdx = 0;
            if (activeFolder.folderCategory === 'personal') {
                await updateFolderAndActiveFolder(userId, 0, activeFolder.folderId, 0)
            } else if (activeFolder.folderCategory === 'community') {
                await updateUserActiveFolderItemIdx(userId, 0, 0)
            }
        }

        // Make the the activeFolderItemIdx the last item if it is less than 0
        if (activeFolderItemIdx < 0) {
            activeFolderItemIdx = folderItems.length - 1;
            if (activeFolder.folderCategory === 'personal') {
                await updateFolderAndActiveFolder(userId, 0, activeFolder.folderId, folderItems.length - 1)
            } else if (activeFolder.folderCategory === 'community') {
                await updateUserActiveFolderItemIdx(userId, folderItems.length - 1)
            }
        }

        if (folderItems.length <= 0) {
            return null;
        }

        // Get the current folder item based on the active folder item index
        const currentFolderItem = folderItems[activeFolderItemIdx];

        // Return an object containing the current folder item, the folder category, and the folder index
        return {
            folderItem: currentFolderItem,
            folderCategory: activeFolder?.folderCategory,
            folderIdx: activeFolderItemIdx,
            folderItemsLength: folderItems.length,
            folderId: activeFolder.folderId
        };
    } catch (err) {
        // If an error occurs, log the error and return null
        console.error(err);
        return null; // Return null if an error occurs
    }
}




// Defining a GET route for the express app
app.get("/api/activeUserImage/:userId", async (req, res) => {
    // Check if the user exists
    const userId = req.params.userId;
    const activeFolder = await getActiveFolder(userId);
    if (!activeFolder) {
        return res.status(404).send("User not found");
    }

    const { folderItem } = await getActiveFolderItemImageURL(userId, activeFolder);
    const activeImageUrl = applyEffectToCloudinaryImage(folderItem.image, folderItem.description)


    return res.status(200).send(activeImageUrl);
});

// Defining the port on which the express app will listen
const PORT = 3000;

// Making the express app listen on the defined port
app.listen(PORT, console.log(`listening on PORT ${PORT}`));

