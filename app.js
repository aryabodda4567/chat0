// ========== CONFIGURATION ==========
// Set this to your production URL where static files are hosted.
// Leave empty ('') to use the current browser URL (for local/file:// usage).
const SERVER_URL = 'https://chat0-ashen.vercel.app/';

// ========== DOM REFERENCES ==========
const lobby = document.getElementById('lobby');
const callScreen = document.getElementById('call-screen');
const endedScreen = document.getElementById('ended-screen');
const endedMessage = document.getElementById('ended-message');
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
const switchCamBtn = document.getElementById('switch-cam-btn');
const endBtn = document.getElementById('end-btn');
const videosContainer = document.getElementById('videos-container');
const enableCamBtn = document.getElementById('enable-cam-btn');
const cameraHint = document.getElementById('camera-hint');

// ========== STATE ==========
let peer = null;
let localStream = null;
let currentCall = null;
let roomId = null;
let isHost = false;
let currentFacingMode = 'user'; // 'user' = front, 'environment' = back

// ========== ICE SERVERS (STUN + TURN) ==========
const ICE_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
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

function showScreen(screen) {
    lobby.classList.remove('active');
    callScreen.classList.remove('active');
    endedScreen.classList.remove('active');
    screen.classList.add('active');
}

// ========== MEDIA ==========
async function getLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: currentFacingMode },
            audio: true
        });
        localVideo.srcObject = localStream;
        return localStream;
    } catch (err) {
        // Try without facingMode constraint
        try {
            localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });
            localVideo.srcObject = localStream;
            return localStream;
        } catch (fallbackErr) {
            console.error('Cannot access camera/microphone:', fallbackErr);
            setStatus('error', 'Camera/Mic access denied');
            throw fallbackErr;
        }
    }
}

// ========== CALL HANDLING ==========
function handleCall(call) {
    currentCall = call;

    call.on('stream', (remoteStream) => {
        remoteVideo.srcObject = remoteStream;
        remoteLabel.textContent = 'Connected';
        remoteVideo.play().catch(() => { });
    });

    call.on('close', () => {
        showEndedScreen('The other person left the call.');
    });

    call.on('error', (err) => {
        console.error('Call error:', err);
        showEndedScreen('Call error occurred.');
    });

    // Monitor the underlying peer connection for late-arriving tracks
    const pc = call.peerConnection;
    if (pc) {
        pc.ontrack = (event) => {
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
            remoteVideo.play().catch(() => { });
            remoteLabel.textContent = 'Connected';
        };

        pc.oniceconnectionstatechange = () => {
            console.log('ICE state:', pc.iceConnectionState);
            if (pc.iceConnectionState === 'failed') {
                remoteLabel.textContent = 'Connection failed…';
            } else if (pc.iceConnectionState === 'disconnected') {
                remoteLabel.textContent = 'Reconnecting…';
            } else if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
                remoteLabel.textContent = 'Connected';
            }
        };
    }
}

function showEndedScreen(message) {
    // Stop all tracks
    if (currentCall) {
        currentCall.close();
        currentCall = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    if (peer) {
        peer.destroy();
        peer = null;
    }

    // Reset video elements
    remoteVideo.srcObject = null;
    localVideo.srcObject = null;

    // Show ended screen
    endedMessage.textContent = message || 'The call has been disconnected.';
    showScreen(endedScreen);
}

// ========== PEER INITIALIZATION ==========
function initPeer() {
    const urlRoom = getRoomIdFromUrl();

    if (urlRoom) {
        isHost = false;
        roomId = urlRoom;
        setStatus('connecting', 'Connecting to call…');
        joinSection.classList.remove('hidden');
        peer = new Peer(undefined, { config: ICE_SERVERS });
    } else {
        isHost = true;
        roomId = generateRoomId();
        peer = new Peer(roomId, { config: ICE_SERVERS });
    }

    peer.on('open', (id) => {
        if (isHost) {
            const shareUrl = buildShareUrl(roomId);
            shareLinkInput.value = shareUrl;
            shareSection.classList.remove('hidden');
            setStatus('connected', 'Ready — share the link to start');

            // Do NOT auto-start camera — mobile browsers need a user gesture
            // The 'Enable Camera' button handles this
        } else {
            setStatus('connected', 'Ready to join');
        }
    });

    // Host: receive incoming call
    peer.on('call', async (call) => {
        try {
            // Use existing stream if camera was already enabled, otherwise acquire
            if (!localStream) {
                await getLocalStream();
            }
            call.answer(localStream);
            handleCall(call);
            showScreen(callScreen);
        } catch (err) {
            console.error('Failed to answer call:', err);
        }
    });

    peer.on('error', (err) => {
        console.error('Peer error:', err);
        if (err.type === 'peer-unavailable') {
            setStatus('error', 'Call not found — link may be expired');
        } else if (err.type === 'unavailable-id') {
            roomId = generateRoomId();
            peer.destroy();
            peer = new Peer(roomId, { config: ICE_SERVERS });
            initPeer();
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
        showScreen(callScreen);
    } catch (err) {
        console.error('Failed to join call:', err);
        joinBtn.disabled = false;
        joinBtn.textContent = 'Join Call';
        setStatus('error', 'Failed to join — check permissions');
    }
});

// ========== ENABLE CAMERA (user gesture for mobile) ==========
enableCamBtn.addEventListener('click', async () => {
    try {
        enableCamBtn.textContent = 'Starting…';
        enableCamBtn.disabled = true;
        await getLocalStream();
        enableCamBtn.innerHTML = '✓ Camera Ready';
        enableCamBtn.classList.add('camera-ready');
        cameraHint.textContent = 'Camera is ready. Waiting for someone to join…';
    } catch (err) {
        enableCamBtn.textContent = 'Retry Enable Camera';
        enableCamBtn.disabled = false;
        console.error('Failed to enable camera:', err);
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
    showEndedScreen('You ended the call.');
});

// ========== SWITCH CAMERA ==========
switchCamBtn.addEventListener('click', async () => {
    if (!localStream) return;

    // Toggle facing mode
    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';

    try {
        // Get new video stream with the other camera
        const newStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: currentFacingMode },
            audio: false
        });

        const newVideoTrack = newStream.getVideoTracks()[0];
        const oldVideoTrack = localStream.getVideoTracks()[0];

        // Replace the track in the peer connection
        if (currentCall && currentCall.peerConnection) {
            const sender = currentCall.peerConnection
                .getSenders()
                .find(s => s.track && s.track.kind === 'video');
            if (sender) {
                await sender.replaceTrack(newVideoTrack);
            }
        }

        // Replace the track in the local stream
        if (oldVideoTrack) {
            oldVideoTrack.stop();
            localStream.removeTrack(oldVideoTrack);
        }
        localStream.addTrack(newVideoTrack);
        localVideo.srcObject = localStream;

        // Animate the button
        switchCamBtn.style.transform = 'scale(1.15) rotate(180deg)';
        setTimeout(() => { switchCamBtn.style.transform = ''; }, 300);
    } catch (err) {
        console.error('Failed to switch camera:', err);
        // Revert facing mode
        currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
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
