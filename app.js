// ========== CONFIGURATION ==========
const SERVER_URL = "https://chat0-ashen.vercel.app/";

// ========== DOM REFERENCES ==========
const lobby = document.getElementById("lobby");
const callScreen = document.getElementById("call-screen");
const endedScreen = document.getElementById("ended-screen");
const endedMessage = document.getElementById("ended-message");
const statusIndicator = document.getElementById("status-indicator");
const statusText = document.getElementById("status-text");

const shareSection = document.getElementById("share-section");
const shareLinkInput = document.getElementById("share-link");
const copyBtn = document.getElementById("copy-btn");
const copyText = document.getElementById("copy-text");

const joinSection = document.getElementById("join-section");
const joinBtn = document.getElementById("join-btn");

const localVideo = document.getElementById("local-video");
const remoteVideo = document.getElementById("remote-video");
const remoteLabel = document.getElementById("remote-label");

const micBtn = document.getElementById("mic-btn");
const camBtn = document.getElementById("cam-btn");
const switchCamBtn = document.getElementById("switch-cam-btn");
const endBtn = document.getElementById("end-btn");

const enableCamBtn = document.getElementById("enable-cam-btn");
const cameraHint = document.getElementById("camera-hint");

// ========== STATE ==========
let peer = null;
let localStream = null;
let currentCall = null;
let roomId = null;
let isHost = false;
let currentFacingMode = "user";

// ========== TURN SERVERS (Metered.ca free tier) ==========
// Sign up free at https://dashboard.metered.ca  →  Create App  →  Copy API Key
// Free tier = 500 GB/month — more than enough for personal use.
const METERED_API_KEY = "6701af57165c5eeb4b76493fe8f9666112e5";

// Fallback: STUN-only (works on WiFi, fails on mobile carriers)
let iceConfig = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
    ]
};

// Fetch real TURN credentials from Metered.ca
async function fetchTurnCredentials() {
    if (!METERED_API_KEY) {
        console.warn("No METERED_API_KEY set — STUN only. Mobile-to-mobile may fail.");
        return;
    }
    try {
        const resp = await fetch(
            `https://chat0.metered.live/api/v1/turn/credentials?apiKey=${METERED_API_KEY}`
        );
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        const turnServers = await resp.json();
        iceConfig = {
            iceServers: [
                { urls: "stun:stun.l.google.com:19302" },
                ...turnServers
            ]
        };
        console.log("TURN credentials loaded:", turnServers.length, "servers");
    } catch (e) {
        console.error("Failed to fetch TURN credentials:", e);
    }
}

// ========== UTILITIES ==========
function generateRoomId() {
    return Math.random().toString(36).substring(2, 10);
}

function getRoomIdFromUrl() {
    return new URLSearchParams(window.location.search).get("room");
}

function buildShareUrl(id) {
    const base = SERVER_URL || window.location.origin + window.location.pathname;
    const url = new URL(base);
    url.searchParams.set("room", id);
    return url.toString();
}

function setStatus(type, text) {
    statusIndicator.className = "status " + type;
    statusText.textContent = text;
}

function showScreen(screen) {
    lobby.classList.remove("active");
    callScreen.classList.remove("active");
    endedScreen.classList.remove("active");
    screen.classList.add("active");
}

// ========== MEDIA ==========
async function getLocalStream() {
    // First try with preferred facing mode
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: currentFacingMode },
            audio: true
        });
    } catch (e1) {
        console.warn("facingMode failed, trying without:", e1.name);
        // Fallback: no facingMode constraint
        try {
            localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });
        } catch (e2) {
            console.error("getUserMedia failed completely:", e2.name, e2.message);
            setStatus("error", "Camera/Mic blocked — check permissions");
            throw e2;
        }
    }

    localVideo.srcObject = localStream;
    localVideo.muted = true;

    // Explicitly play — needed on iOS Safari
    try { await localVideo.play(); } catch (_) { /* OK */ }

    return localStream;
}

// ========== CALL HANDLING ==========
function handleCall(call) {
    currentCall = call;

    call.on("stream", async (remoteStream) => {
        console.log("Remote stream received, tracks:", remoteStream.getTracks().map(t => t.kind + ":" + t.readyState));

        remoteVideo.srcObject = remoteStream;

        // iOS Safari blocks autoplay of videos with audio.
        // Fix: start muted (always allowed), play, then unmute.
        remoteVideo.muted = true;
        try {
            await remoteVideo.play();
        } catch (e) {
            console.warn("play() failed even muted:", e);
        }
        // Unmute after playback has started
        remoteVideo.muted = false;

        remoteLabel.textContent = "Connected";
    });

    call.on("close", () => {
        showEndedScreen("The other person left the call.");
    });

    call.on("error", (err) => {
        console.error("Call error:", err);
        showEndedScreen("Call error occurred.");
    });

    // Monitor ICE connection for debugging
    const pc = call.peerConnection;
    if (pc) {
        // Catch late-arriving tracks (important on mobile)
        pc.ontrack = (event) => {
            console.log("ontrack event:", event.track.kind);
            if (event.streams && event.streams[0]) {
                remoteVideo.srcObject = event.streams[0];
            } else {
                let stream = remoteVideo.srcObject;
                if (!stream || !(stream instanceof MediaStream)) {
                    stream = new MediaStream();
                    remoteVideo.srcObject = stream;
                }
                stream.addTrack(event.track);
            }
            // Same muted→play→unmute trick
            remoteVideo.muted = true;
            remoteVideo.play().then(() => { remoteVideo.muted = false; }).catch(() => { });
            remoteLabel.textContent = "Connected";
        };

        pc.oniceconnectionstatechange = () => {
            const state = pc.iceConnectionState;
            console.log("ICE state:", state);
            if (state === "failed") {
                remoteLabel.textContent = "Connection failed";
            } else if (state === "disconnected") {
                remoteLabel.textContent = "Reconnecting…";
            } else if (state === "connected" || state === "completed") {
                remoteLabel.textContent = "Connected";
            }
        };
    }
}

// ========== END CALL ==========
function showEndedScreen(message) {
    if (currentCall) {
        currentCall.close();
        currentCall = null;
    }

    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }

    if (peer && !peer.destroyed) {
        peer.destroy();
        peer = null;
    }

    remoteVideo.srcObject = null;
    localVideo.srcObject = null;

    endedMessage.textContent = message || "The call has been disconnected.";
    showScreen(endedScreen);
}

// ========== PEER INIT ==========
function initPeer() {
    const urlRoom = getRoomIdFromUrl();

    if (urlRoom) {
        isHost = false;
        roomId = urlRoom;
        joinSection.classList.remove("hidden");
        setStatus("connecting", "Connecting…");
        peer = new Peer(undefined, { config: iceConfig });
    } else {
        isHost = true;
        roomId = generateRoomId();
        peer = new Peer(roomId, { config: iceConfig });
    }

    peer.on("open", (id) => {
        console.log("Peer open, id:", id);
        if (isHost) {
            shareLinkInput.value = buildShareUrl(roomId);
            shareSection.classList.remove("hidden");
            setStatus("connected", "Share the link to start");
        } else {
            setStatus("connected", "Ready to join");
        }
    });

    // Host: answer incoming call
    peer.on("call", async (call) => {
        console.log("Incoming call");
        try {
            if (!localStream) await getLocalStream();
            call.answer(localStream);
            handleCall(call);
            showScreen(callScreen);
        } catch (err) {
            console.error("Failed to answer call:", err);
            setStatus("error", "Failed to start camera");
        }
    });

    peer.on("error", (err) => {
        console.error("Peer error:", err.type, err);
        if (err.type === "peer-unavailable") {
            setStatus("error", "Room not found — link may have expired");
        } else if (err.type === "unavailable-id") {
            setStatus("error", "Room ID taken — retrying…");
            roomId = generateRoomId();
            peer.destroy();
            initPeer();
        } else {
            setStatus("error", err.type || "Connection error");
        }
    });

    // Auto-reconnect if websocket drops
    peer.on("disconnected", () => {
        console.log("Peer disconnected, reconnecting…");
        setStatus("connecting", "Reconnecting…");
        if (peer && !peer.destroyed) {
            peer.reconnect();
        }
    });
}

// ========== BOOT ==========
async function boot() {
    await fetchTurnCredentials();
    initPeer();
}

// ========== JOIN ==========
joinBtn.addEventListener("click", async () => {
    try {
        joinBtn.disabled = true;
        joinBtn.textContent = "Connecting…";

        await getLocalStream();

        const call = peer.call(roomId, localStream);
        if (!call) {
            throw new Error("peer.call returned null — room may not exist");
        }

        handleCall(call);
        showScreen(callScreen);
    } catch (err) {
        console.error("Join failed:", err);
        joinBtn.disabled = false;
        joinBtn.textContent = "Join Call";
        setStatus("error", "Failed to join — check permissions");
    }
});

// ========== ENABLE CAMERA (user gesture for mobile) ==========
enableCamBtn.addEventListener("click", async () => {
    try {
        enableCamBtn.disabled = true;
        enableCamBtn.textContent = "Starting…";
        await getLocalStream();
        enableCamBtn.innerHTML = "✓ Camera Ready";
        cameraHint.textContent = "Camera ready. Waiting for someone to join…";
    } catch (e) {
        enableCamBtn.disabled = false;
        enableCamBtn.textContent = "Retry";
    }
});

// ========== COPY LINK ==========
copyBtn.addEventListener("click", async () => {
    try {
        await navigator.clipboard.writeText(shareLinkInput.value);
    } catch (_) {
        // Fallback for mobile Safari / insecure contexts
        shareLinkInput.select();
        shareLinkInput.setSelectionRange(0, 99999);
        document.execCommand("copy");
    }
    copyText.textContent = "Copied!";
    setTimeout(() => { copyText.textContent = "Copy"; }, 2000);
});

// ========== CONTROLS ==========
micBtn.addEventListener("click", () => {
    if (!localStream) return;
    const t = localStream.getAudioTracks()[0];
    if (t) {
        t.enabled = !t.enabled;
        micBtn.classList.toggle("active", t.enabled);
    }
});

camBtn.addEventListener("click", () => {
    if (!localStream) return;
    const t = localStream.getVideoTracks()[0];
    if (t) {
        t.enabled = !t.enabled;
        camBtn.classList.toggle("active", t.enabled);
    }
});

endBtn.addEventListener("click", () => {
    showEndedScreen("You ended the call.");
});

// ========== SWITCH CAMERA ==========
switchCamBtn.addEventListener("click", async () => {
    if (!localStream || !currentCall) return;

    currentFacingMode = currentFacingMode === "user" ? "environment" : "user";

    try {
        const newStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: currentFacingMode },
            audio: false
        });

        const newTrack = newStream.getVideoTracks()[0];
        const sender = currentCall.peerConnection
            .getSenders()
            .find(s => s.track && s.track.kind === "video");

        if (sender) await sender.replaceTrack(newTrack);

        const old = localStream.getVideoTracks()[0];
        if (old) {
            old.stop();
            localStream.removeTrack(old);
        }
        localStream.addTrack(newTrack);
        localVideo.srcObject = localStream;
    } catch (err) {
        console.error("Switch camera failed:", err);
        // Revert facing mode on failure
        currentFacingMode = currentFacingMode === "user" ? "environment" : "user";
    }
});

// ========== INIT ==========
boot();
