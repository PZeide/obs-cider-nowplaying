const CIDER_WEBSOCKET_URL = "ws://localhost:26369";
const RECONNECT_TIMEOUT = 5000;

// A reference to the WebSocket instance currently in use.
let socket;

// Track id of the last track we've received an update about.
let lastTrackId;

// Id of the timeout when we've received an track update about "no-track-id".
// We use this to cancel the timeout if we've received a valid track update 
// before assuming that the playback stopped.
let noIdFoundTimeout;

// Id of the timeout to check if we're currently waiting for valid track attributes.
// We use this to send uncomplete data if we didn't received any update from MusicKit API
// after a certain amount of time.
let validAttributesTimeout;

let onTrackChangedHandlers = [];
let onTrackTimelineUpdateHandlers = [];
let onPlaybackStopHandlers = [];

export function connect() {
    socket = new WebSocket(CIDER_WEBSOCKET_URL);
    socket.onopen = (_) => {
        console.log("Socket successfully connected to Cider.");

        const identifyPayload = {
            action: "identify",
            name: "Cider-NowPlaying",
            author: "PZeide",
            version: "1.0.0"
        };

        socket.send(JSON.stringify(identifyPayload));

        // After identifying, we ask for the current track.
        const playerStateUpdatePayload = {
            action: "get-currentmediaitem"
        };

        socket.send(JSON.stringify(playerStateUpdatePayload));
    };

    socket.onmessage = (e) => {
        const message = JSON.parse(e.data);
        switch (message.type) {
            case "playbackStateUpdate":
                playbackStateUpdate(message.data);
                break;

            case "musickitapi.song":
                // This is the result to our request to obtain valid attributes for a potential iCloud uploaded track.
                const attributes = message.data.attributes;
                attributes._validAttributes = true;
                playbackStateUpdate(attributes);
                break;

            default:
                break;
        }
    };

    socket.onerror = (_) => {
        socket.close();
    };

    socket.onclose = (_) => {
        console.log(`Socket closed, retrying connection in ${RECONNECT_TIMEOUT}ms`);
        setTimeout(connect, RECONNECT_TIMEOUT);
        onPlaybackStopHandlers.forEach((handler) => handler());
    };
}

export function onTrackChanged(handler) {
    onTrackChangedHandlers.push(handler);
}

export function onTrackTimelineUpdate(handler) {
    onTrackTimelineUpdateHandlers.push(handler);
}

export function onPlaybackStop(handler) {
    onPlaybackStopHandlers.push(handler);
}

function playbackStateUpdate(data) {
    const trackId = data.playParams.id;

    if (trackId == "no-id-found") {
        // This is the case when playback state changed (stop for example)
        // or the track changed and MusicKit hasn't finished loading the new one.
        // So we should wait if any new track is sent to the websocket before 
        // being sure that the playback really stopped.

        if (noIdFoundTimeout)
            return;

        noIdFoundTimeout = setTimeout(() => {
            onPlaybackStopHandlers.forEach((handler) => handler());
            noIdFoundTimeout = null;
        }, 2000);

        lastTrackId = "no-id-found";
        return;
    }   

    if (noIdFoundTimeout) {
        // Track id changed and noIdFound timer is running, we can cancel it.
        clearTimeout(noIdFoundTimeout);
        noIdFoundTimeout = null;
    }

    if (trackId == lastTrackId) {
        // The track is the same as before, only update the track timeline.
        if (!data.remainingTime)
            return;

        onTrackTimelineUpdateHandlers.forEach((handler) => handler({
            duration: data.durationInMillis,
            position: data.durationInMillis - data.remainingTime
        }));
        return;
    }

    if (!data.artwork.url && !data._validAttributes) {
        // Artwork data is missing, this is probably an iCloud uploaded track and these attributes
        // aren't coming from our request for valid attributes.
        
        if (validAttributesTimeout) {
            // We are already waiting for valid attributes.
            return;
        }

        const musicKitApiPayload = {
            action: "musickit-api",
            method: "song",
            id: data.playParams.id,
            params: {},
            library: true
        };

        socket.send(JSON.stringify(musicKitApiPayload));
        validAttributesTimeout = setTimeout(() => {
            data._validAttributes = true;
            playbackStateUpdate(data._validAttributes);
            validAttributesTimeout = null;
        }, 1000);

        return;
    }

    if (validAttributesTimeout) {
        // We've received our valid attributes, cancel the timer.
        clearTimeout(validAttributesTimeout);
        validAttributesTimeout = null;
    }

    lastTrackId = data.playParams.id;
    onTrackChangedHandlers.forEach((handler) => handler(data));

    if (data.remainingTime) {
        onTrackTimelineUpdateHandlers.forEach((handler) => handler({
            duration: data.durationInMillis,
            position: data.durationInMillis - data.remainingTime
        }));
    }
}