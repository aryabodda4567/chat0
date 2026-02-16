// ========== CONFIGURATION ==========
// Set this to your production URL where static files are hosted.
// Leave empty ('') to use the current browser URL (for local/file:// usage).
// Examples:
//   const SERVER_URL = 'https://your-app.vercel.app';
//   const SERVER_URL = 'https://your-app.netlify.app';
//   const SERVER_URL = 'http://localhost:5500';
const SERVER_URL = 'https://chat0-ashen.vercel.app/';

// ========== DOM REFERENCES ==========
const lobby = document.getElementById('lobby');
const callScreen = document.getElementById('call-screen');
const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');
const shareSection = document.getElementById('share-section');
const shareLinkInput = document.getElementById('share-link');
const copyBtn = document.getElementById('copy-btn');
const copyText = document.getElementById('copy-text');
const joinSection = document.getElementById('join-section');
const joinBtn = document.getElementById('join-btn');
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const remoteLabel = document.getElementById('remote-label');
const micBtn = document.getElementById('mic-btn');
const camBtn = document.getElementById('cam-btn');
const endBtn = document.getElementById('end-btn');
const upgradeBtn = document.getElementById('upgrade-btn');
const videosContainer = document.getElementById('videos-container');

// ========== STATE ==========
let peer = null;
let localStream = null;
let currentCall = null;
let roomId = null;
let isHost = false;
let callMode = 'video'; // 'video' or 'voice'

// ========== ICE SERVERS (STUN + TURN) ==========
const ICE_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        // Free TURN server from Open Relay Project
        {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        }
    ]
};

// ========== UTILITIES ==========
function generateRoomId() {
    return Math.random().toString(36).substring(2, 8) + Math.random().toString(36).substring(2, 4);
}

function getRoomIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('room');
}

function buildShareUrl(id) {
    const base = SERVER_URL || window.location.origin + window.location.pathname;
    const url = new URL(base);
    url.searchParams.set('room', id);
    return url.toString();
}

function setStatus(type, text) {
    statusIndicator.className = 'status ' + type;
    statusText.textContent = text;
}

// ========== MEDIA ==========
async function getLocalStream() {
    const constraints = {
        audio: true,
        video: callMode === 'video'
    };
    try {
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        localVideo.srcObject = localStream;
        if (callMode === 'voice') {
            camBtn.classList.remove('active');
        }
        return localStream;
    } catch (err) {
        if (callMode === 'video') {
            // Fallback to audio only
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
                localVideo.srcObject = localStream;
                callMode = 'voice';
                camBtn.classList.remove('active');
                return localStream;
            } catch (audioErr) {
                console.error('Cannot access media devices:', audioErr);
                setStatus('error', 'Camera/Mic access denied');
                throw audioErr;
            }
        } else {
            console.error('Cannot access microphone:', err);
            setStatus('error', 'Microphone access denied');
            throw err;
        }
    }
}

// ========== CALL HANDLING ==========
function handleCall(call) {
    currentCall = call;

    call.on('stream', (remoteStream) => {
        remoteVideo.srcObject = remoteStream;
        remoteLabel.textContent = 'Connected';
        // Ensure video plays (autoplay policy)
        remoteVideo.play().catch(() => { });
    });

    call.on('close', () => {
        endCall(false);
    });

    call.on('error', (err) => {
        console.error('Call error:', err);
        endCall(false);
    });
}

function switchToCallScreen() {
    lobby.classList.remove('active');
    callScreen.classList.add('active');
    updateCallScreenMode();
}

function updateCallScreenMode() {
    if (callMode === 'voice') {
        videosContainer.classList.add('voice-only-mode');
        camBtn.classList.add('hidden');
        upgradeBtn.classList.remove('hidden');
        upgradeBtn.classList.remove('downgrade-active');
        upgradeBtn.title = 'Upgrade to Video';
    } else {
        videosContainer.classList.remove('voice-only-mode');
        camBtn.classList.remove('hidden');
        upgradeBtn.classList.remove('hidden');
        upgradeBtn.classList.add('downgrade-active');
        upgradeBtn.title = 'Switch to Voice Only';
    }
}

function endCall(closePeer = true) {
    if (currentCall) {
        currentCall.close();
        currentCall = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    if (closePeer && peer) {
        peer.destroy();
        peer = null;
    }

    // Reset UI
    remoteVideo.srcObject = null;
    localVideo.srcObject = null;
    callScreen.classList.remove('active');
    lobby.classList.add('active');
    remoteLabel.textContent = 'Waiting for peer…';

    // Re-initialize
    micBtn.classList.add('active');
    camBtn.classList.add('active');

    // Reload to reset state cleanly
    window.location.href = window.location.pathname;
}

// ========== PEER INITIALIZATION ==========
function initPeer() {
    const urlRoom = getRoomIdFromUrl();

    if (urlRoom) {
        // Joiner: connect to the host's peer ID
        isHost = false;
        roomId = urlRoom;
        setStatus('connecting', 'Connecting to call…');
        joinSection.classList.remove('hidden');

        // Create peer with random ID for the joiner
        peer = new Peer(undefined, { config: ICE_SERVERS });
    } else {
        // Host: create a room
        isHost = true;
        roomId = generateRoomId();

        // Use room ID as peer ID so joiner can find us
        peer = new Peer(roomId, { config: ICE_SERVERS });
    }

    peer.on('open', (id) => {
        if (isHost) {
            const shareUrl = buildShareUrl(roomId);
            shareLinkInput.value = shareUrl;
            shareSection.classList.remove('hidden');
            setStatus('connected', 'Ready — share the link to start');

            // Pre-start local video for host
            getLocalStream().then(() => {
                // Show a small preview, then wait for peer
            }).catch(() => { });
        } else {
            setStatus('connected', 'Ready to join');
        }
    });

    // Host: receive incoming call
    peer.on('call', async (call) => {
        try {
            // Always re-acquire stream to match current callMode selection
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
                localStream = null;
            }
            await getLocalStream();
            call.answer(localStream);
            handleCall(call);
            switchToCallScreen();
        } catch (err) {
            console.error('Failed to answer call:', err);
        }
    });

    peer.on('error', (err) => {
        console.error('Peer error:', err);
        if (err.type === 'peer-unavailable') {
            setStatus('error', 'Call not found — link may be expired');
        } else if (err.type === 'unavailable-id') {
            // Room ID already taken, generate new one
            roomId = generateRoomId();
            peer.destroy();
            peer = new Peer(roomId, { config: ICE_SERVERS });
            initPeerEvents();
        } else {
            setStatus('error', 'Connection error: ' + err.type);
        }
    });

    peer.on('disconnected', () => {
        setStatus('connecting', 'Reconnecting…');
        if (peer && !peer.destroyed) {
            peer.reconnect();
        }
    });
}

// ========== JOIN BUTTON ==========
joinBtn.addEventListener('click', async () => {
    try {
        joinBtn.disabled = true;
        joinBtn.textContent = 'Connecting…';

        await getLocalStream();

        const call = peer.call(roomId, localStream, { config: ICE_SERVERS });
        handleCall(call);
        switchToCallScreen();
    } catch (err) {
        console.error('Failed to join call:', err);
        joinBtn.disabled = false;
        joinBtn.textContent = 'Join Call';
        setStatus('error', 'Failed to join — check permissions');
    }
});

// ========== COPY LINK ==========
copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(shareLinkInput.value).then(() => {
        copyText.textContent = 'Copied!';
        copyBtn.style.background = '#48E5C2';
        setTimeout(() => {
            copyText.textContent = 'Copy';
            copyBtn.style.background = '';
        }, 2000);
    }).catch(() => {
        // Fallback
        shareLinkInput.select();
        document.execCommand('copy');
        copyText.textContent = 'Copied!';
        setTimeout(() => { copyText.textContent = 'Copy'; }, 2000);
    });
});

// ========== CONTROLS ==========
micBtn.addEventListener('click', () => {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        micBtn.classList.toggle('active', audioTrack.enabled);
    }
});

camBtn.addEventListener('click', () => {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        camBtn.classList.toggle('active', videoTrack.enabled);
    }
});

endBtn.addEventListener('click', () => {
    endCall(true);
});

// ========== CALL TYPE PICKER ==========
document.querySelectorAll('.call-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const parent = btn.closest('.call-type-btns');
        parent.querySelectorAll('.call-type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        callMode = btn.dataset.mode;
    });
});

// ========== UPGRADE / DOWNGRADE VIDEO ==========
upgradeBtn.addEventListener('click', async () => {
    if (!localStream || !currentCall) return;

    const peerConnection = currentCall.peerConnection;
    if (!peerConnection) return;

    if (callMode === 'voice') {
        // Upgrade to video
        try {
            const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
            const videoTrack = videoStream.getVideoTracks()[0];
            localStream.addTrack(videoTrack);
            localVideo.srcObject = localStream;

            // Add or replace video track in the peer connection
            const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) {
                await sender.replaceTrack(videoTrack);
            } else {
                peerConnection.addTrack(videoTrack, localStream);
            }

            callMode = 'video';
            camBtn.classList.add('active');
            updateCallScreenMode();
        } catch (err) {
            console.error('Failed to upgrade to video:', err);
        }
    } else {
        // Downgrade to voice
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.stop();
            localStream.removeTrack(videoTrack);

            // Remove video track from peer connection
            const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) {
                try {
                    await sender.replaceTrack(null);
                } catch {
                    peerConnection.removeTrack(sender);
                }
            }
        }

        callMode = 'voice';
        camBtn.classList.remove('active');
        updateCallScreenMode();
    }
});

// ========== DRAGGABLE LOCAL VIDEO ==========
(function makeDraggable() {
    const el = document.getElementById('local-video-wrapper');
    let isDragging = false;
    let startX, startY, startLeft, startBottom;

    el.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        startLeft = el.offsetLeft;
        startBottom = window.innerHeight - el.offsetTop - el.offsetHeight;
        el.style.cursor = 'grabbing';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        el.style.right = 'auto';
        el.style.left = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, startLeft + dx)) + 'px';
        el.style.bottom = Math.max(80, Math.min(window.innerHeight - el.offsetHeight - 10, startBottom - dy)) + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            el.style.cursor = 'grab';
        }
    });

    // Touch support
    el.addEventListener('touchstart', (e) => {
        const touch = e.touches[0];
        isDragging = true;
        startX = touch.clientX;
        startY = touch.clientY;
        startLeft = el.offsetLeft;
        startBottom = window.innerHeight - el.offsetTop - el.offsetHeight;
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        const touch = e.touches[0];
        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;
        el.style.right = 'auto';
        el.style.left = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, startLeft + dx)) + 'px';
        el.style.bottom = Math.max(80, Math.min(window.innerHeight - el.offsetHeight - 10, startBottom - dy)) + 'px';
    }, { passive: true });

    document.addEventListener('touchend', () => {
        isDragging = false;
    });
})();

// ========== INIT ==========
initPeer();
