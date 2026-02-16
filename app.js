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

// ========== ICE SERVERS ==========
const ICE_SERVERS = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },

        { urls: "stun:stun.relay.metered.ca:80" },
        {
            urls: "turn:global.relay.metered.ca:80",
            username: "openrelayproject",
            credential: "openrelayproject"
        },
        {
            urls: "turn:global.relay.metered.ca:443",
            username: "openrelayproject",
            credential: "openrelayproject"
        },
        {
            urls: "turn:global.relay.metered.ca:443?transport=tcp",
            username: "openrelayproject",
            credential: "openrelayproject"
        }
    ]
};

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
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: currentFacingMode },
            audio: true
        });
    } catch {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });
    }

    localVideo.srcObject = localStream;
    localVideo.muted = true;
    await localVideo.play().catch(() => { });
    return localStream;
}

// ========== CALL HANDLING ==========
function handleCall(call) {
    currentCall = call;

    call.on("stream", async (remoteStream) => {
        console.log("Remote stream received");

        remoteVideo.srcObject = remoteStream;
        remoteVideo.setAttribute("playsinline", true);

        try {
            await remoteVideo.play();
        } catch (e) {
            console.log("Autoplay blocked:", e);
        }

        remoteLabel.textContent = "Connected";
    });

    call.on("close", () => {
        showEndedScreen("The other person left the call.");
    });

    call.on("error", (err) => {
        console.error("Call error:", err);
        showEndedScreen("Call error occurred.");
    });

    const pc = call.peerConnection;
    if (pc) {
        pc.oniceconnectionstatechange = () => {
            console.log("ICE:", pc.iceConnectionState);

            if (pc.iceConnectionState === "failed") {
                remoteLabel.textContent = "Connection failed";
            } else if (pc.iceConnectionState === "disconnected") {
                remoteLabel.textContent = "Reconnecting...";
            } else if (
                pc.iceConnectionState === "connected" ||
                pc.iceConnectionState === "completed"
            ) {
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

    endedMessage.textContent =
        message || "The call has been disconnected.";
    showScreen(endedScreen);
}

// ========== PEER INIT ==========
function initPeer() {
    const urlRoom = getRoomIdFromUrl();

    if (urlRoom) {
        isHost = false;
        roomId = urlRoom;
        joinSection.classList.remove("hidden");
        setStatus("connecting", "Connecting...");
        peer = new Peer(undefined, { config: ICE_SERVERS });
    } else {
        isHost = true;
        roomId = generateRoomId();
        peer = new Peer(roomId, { config: ICE_SERVERS });
    }

    peer.on("open", () => {
        if (isHost) {
            shareLinkInput.value = buildShareUrl(roomId);
            shareSection.classList.remove("hidden");
            setStatus("connected", "Ready — share link");
        } else {
            setStatus("connected", "Ready to join");
        }
    });

    peer.on("call", async (call) => {
        try {
            if (!localStream) await getLocalStream();
            call.answer(localStream);
            handleCall(call);
            showScreen(callScreen);
        } catch (err) {
            console.error(err);
        }
    });

    peer.on("error", (err) => {
        console.error("Peer error:", err);
        setStatus("error", err.type || "Connection error");
    });
}

// ========== JOIN ==========
joinBtn.addEventListener("click", async () => {
    try {
        joinBtn.disabled = true;
        joinBtn.textContent = "Connecting...";

        await getLocalStream();

        // IMPORTANT FIX: NO CONFIG HERE
        const call = peer.call(roomId, localStream);

        handleCall(call);
        showScreen(callScreen);
    } catch (err) {
        console.error(err);
        joinBtn.disabled = false;
        joinBtn.textContent = "Join Call";
    }
});

// ========== ENABLE CAMERA ==========
enableCamBtn.addEventListener("click", async () => {
    try {
        enableCamBtn.disabled = true;
        enableCamBtn.textContent = "Starting...";
        await getLocalStream();
        enableCamBtn.innerHTML = "✓ Camera Ready";
        cameraHint.textContent = "Waiting for peer...";
    } catch (e) {
        enableCamBtn.disabled = false;
        enableCamBtn.textContent = "Retry";
    }
});

// ========== COPY LINK ==========
copyBtn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(shareLinkInput.value);
    copyText.textContent = "Copied!";
    setTimeout(() => (copyText.textContent = "Copy"), 2000);
});

// ========== CONTROLS ==========
micBtn.addEventListener("click", () => {
    if (!localStream) return;
    const t = localStream.getAudioTracks()[0];
    t.enabled = !t.enabled;
});

camBtn.addEventListener("click", () => {
    if (!localStream) return;
    const t = localStream.getVideoTracks()[0];
    t.enabled = !t.enabled;
});

endBtn.addEventListener("click", () => {
    showEndedScreen("You ended the call.");
});

// ========== SWITCH CAMERA ==========
switchCamBtn.addEventListener("click", async () => {
    if (!localStream || !currentCall) return;

    currentFacingMode =
        currentFacingMode === "user" ? "environment" : "user";

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
        old.stop();
        localStream.removeTrack(old);
        localStream.addTrack(newTrack);

        localVideo.srcObject = localStream;
    } catch (err) {
        console.error("Switch camera failed", err);
    }
});

// ========== INIT ==========
initPeer();
