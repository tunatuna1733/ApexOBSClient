// this a subset of the features that Apex Legends events provides - however,
// when writing an app that consumes events - it is best if you request
// only those features that you want to handle.
//
// NOTE: in the future we'll have a wildcard option to allow retrieving all
// features
const g_interestedInFeatures = [
    'gep_internal', 'me', 'team', 'kill', 'damage', 'death', 'revive',
    'match_state', 'match_info', 'inventory', 'match_summary', 'roster', 'rank',
    'kill_feed'
];

const itemList = {
    unknown_190: 'Ultimate Accelerator',
    unknown_191: 'Phoenix Kit',
    unknown_192: 'Medic Kit',
    unknown_193: 'Syringe',
    unknown_194: 'Shield Battery',
    unknown_195: 'Shield Cell',
    unknown_225: 'Thermite Granade',
    unknown_226: 'Frag Granade',
    unknown_227: 'Arc Star',
}

const getSecret = (uid) => {
    const configFilePath = `${overwolf.io.paths.localAppData}\\ApexOBSOverlay\\config.json`;
    let secret = '';
    try {
        overwolf.io.fileExists(configFilePath, (res) => {
            if (res.found) {
                overwolf.io.readFileContents(configFilePath, overwolf.io.enums.eEncoding.UTF8, (file) => {
                    if (file.success) {
                        const contents = JSON.parse(file.content);
                        const info = contents.find(v => v.uid === uid);
                        secret = info.secret;
                    }
                })
            } else {
                const generatedSecret = window.crypto.randomUUID();
                secret = generatedSecret;
                const contents = [{
                    uid: uid,
                    secret: generatedSecret
                }];
                overwolf.io.writeFileContents(configFilePath, JSON.stringify(contents), overwolf.io.enums.eEncoding.UTF8, false, () => { });
                fetch('https://apex-ws.deno.dev/register', { method: 'POST', body: JSON.stringify({ uid: uid, secret: secret }) });
            }
        });
    } catch (e) {
        console.error(e);
    }
    return secret;
}

const websocketUrl = 'wss://apex-ws.deno.dev/apex-ws-ow';
// const wsUrlDebug = 'ws://localhost:8000/apex-ws-ow';
let ws;
let isAuthed = false;
window.setTimeout(() => {
    ws = new WebSocket(websocketUrl);
    /*
    ws.addEventListener('message', (e) => {
        const data = e.data;
        if (data.feature === 'Auth' && data.success === true) {
            isAuthed = true;
        }
    })
    */
    ws.onclose = () => {
        window.setTimeout(() => ws = new WebSocket(websocketUrl), 3000);
    }
    window.setInterval(() => {
        if (ws.readyState === WebSocket.CLOSED) {
            ws = new WebSocket(websocketUrl);
        }
    }, 10000);
}, 10000);

let localPlayerUID = '';
let shouldDisplay = false;

const getUID = () => { return localPlayerUID; }
const getShouldDisplay = () => { return shouldDisplay; }
// const getIsAuthed = () => { return isAuthed; }

const getCurrentInfo = () => {
    console.log(`UID: ${localPlayerUID}, shouldDisplay: ${shouldDisplay}`);
}

const sendCurrentInventoryData = () => {
    overwolf.games.events.getInfo((generalInfo) => {
        if (generalInfo.success === true) {
            const inventoryData = [];
            Object.entries(generalInfo.res.me).forEach(([key, value]) => {
                if (key.startsWith('inventory_')) {
                    const data = JSON.parse(value);
                    if (Object.keys(itemList).includes(data.name)) {
                        const invData = {
                            name: itemList[data.name],
                            amount: data.amount
                        };
                        inventoryData.push(invData);
                    }
                }
            });
            // send to websocket
            if (getUID() !== '') {
                const wsData = {
                    uid: getUID(),
                    feature: 'Inventory',
                    data: inventoryData,
                    shouldDisplay: getShouldDisplay()
                }
                ws.send(JSON.stringify(wsData));
            }
        }
    });
}

const sendInitialInventoryData = () => {
    const wsData = {
        uid: getUID(),
        feature: 'Inventory',
        data: [],
        shouldDisplay: getShouldDisplay()
    }
    ws.send(JSON.stringify(wsData));
}

// listeners
const onErrorListener = (info) => {
    console.error('Error: ' + JSON.stringify(info));
};

const onInfoUpdates2Listener = (info) => {
    console.log(info);
    console.log(`UID: ${getUID()}, shouldDisplay: ${getShouldDisplay()}`);
    if (info.feature === 'inventory') {
        if (Object.keys(info.info.me)[0].includes('inventory')) {
            sendCurrentInventoryData();
        }
    } else if (info.feature === 'team') {
        try {
            const data = JSON.parse(Object.values(info.info.match_info)[0]);
            if (data.is_local === true) {
                shouldDisplay = true;
                sendInitialInventoryData();
            }
        } catch (e) {
            // not me maybe
        }
    } else if (info.feature === 'roster') {
        try {
            const data = JSON.parse(Object.values(info.info.match_info)[0]);
            if (data.is_local === '1') {
                localPlayerUID = data.origin_id;
                /*
                if (!isAuthed) {
                    const authData = {
                        uid: data.origin_id,
                        secret: getSecret(data.origin_id),
                        feature: 'Auth'
                    }
                    ws.send(JSON.stringify(authData));
                }
                */
            }
        } catch (e) {
            // not me maybe
        }
    }
};

const onNewEventsListener = (info) => {
    console.log(info);
    if ('events' in info) {
        info.events.forEach((e) => {
            if (e.name === 'kill_feed') {
                // detect own death
                const data = JSON.parse(e.data);
                if (data.local_player_name.replace(' ', '') === data.victimName.replace(' ', '')) {
                    shouldDisplay = false;
                    sendInitialInventoryData();
                }
            } else if (e.name === 'match_end') {
                shouldDisplay = false;
                sendInitialInventoryData
            } else if (e.name === 'respawn') {
                shouldDisplay = true;
                sendInitialInventoryData();
            }
        })
    }
};

const registerEvents = () => {
    overwolf.games.events.onError.addListener(onErrorListener);
    overwolf.games.events.onInfoUpdates2.addListener(onInfoUpdates2Listener);
    overwolf.games.events.onNewEvents.addListener(onNewEventsListener);
};

const unregisterEvents = () => {
    overwolf.games.events.onError.removeListener(onErrorListener);
    overwolf.games.events.onInfoUpdates2.removeListener(onInfoUpdates2Listener);
    overwolf.games.events.onNewEvents.removeListener(onNewEventsListener);
};

const gameLaunched = (gameInfoResult) => {
    if (!gameInfoResult) {
        return false;
    }

    if (!gameInfoResult.gameInfo) {
        return false;
    }

    if (!gameInfoResult.runningChanged && !gameInfoResult.gameChanged) {
        return false;
    }

    if (!gameInfoResult.gameInfo.isRunning) {
        return false;
    }

    // NOTE: we divide by 10 to get the game class id without it's sequence number
    if (Math.floor(gameInfoResult.gameInfo.id / 10) != 21566) {
        return false;
    }

    console.log("Apex Legends Launched");
    return true;
};

const gameRunning = (gameInfo) => {
    if (!gameInfo) {
        return false;
    }

    if (!gameInfo.isRunning) {
        return false;
    }

    // NOTE: we divide by 10 to get the game class id without it's sequence number
    if (Math.floor(gameInfo.id / 10) != 21566) {
        return false;
    }

    console.log("Apex Legends running");
    return true;
};


const setFeatures = () => {
    overwolf.games.events.setRequiredFeatures(g_interestedInFeatures, (info) => {
        if (info.status == "error") {
            //console.log("Could not set required features: " + info.reason);
            //console.log("Trying in 2 seconds");
            window.setTimeout(setFeatures, 2000);
            return;
        }

        console.log("Set required features:");
        console.log(JSON.stringify(info));
    });
};

overwolf.games.getRunningGameInfo((res) => {
    if (gameRunning(res)) {
        registerEvents();
        setTimeout(setFeatures, 1000);
    }
    console.log("getRunningGameInfo: " + JSON.stringify(res));
});

const getinfo = () => {
    overwolf.games.events.getInfo((info) => {
        console.log(info);
    });
}