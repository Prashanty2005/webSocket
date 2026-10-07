// --- DOM Elements ---
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const startBtn = document.getElementById('startBtn');
const callBtn = document.getElementById('callBtn');
const hangupBtn = document.getElementById('hangupBtn');
const acceptBtn = document.getElementById('acceptBtn');
const rejectBtn = document.getElementById('rejectBtn');
const incomingCallDiv = document.getElementById('incomingCall');

// --- WebRTC State Variables ---
let localStream;      // Stores our local camera/mic data
let pc;               // The RTCPeerConnection object (the core of WebRTC)
let currentOffer = null; // Stores an incoming call offer until we accept/reject it
const socket = io();  // Connects to our Node.js signaling server

// --- Configuration ---
// STUN servers find our public IP. TURN servers relay video if firewalls block us.
const iceServers = [
  { urls: 'turn:global.turn.twilio.com:3478?transport=tcp' },
  { 
    urls: 'turn:global.turn.twilio.com:3478?transport=tcp',
    // NOTE: Hardcoding Twilio credentials here is dangerous for production!
    username: '7ee56dc923ea928e51ca443020d69d52aa8d3b8c8f2c67b15aa06dfceed4a4fc',  
    credential: 'OErHpIuKPt5ndqMmjgzSJ8HZ19guU2WANS5tFMyIO5Q=' 
  }
];

// --- Socket.io Signaling Listeners ---
socket.on('offer', handleIncomingOffer); // When someone calls us
socket.on('answer', handleAnswer);       // When someone accepts our call
socket.on('candidate', handleCandidate); // When we get network routing info

// ==========================================
// 1. START CAMERA
// ==========================================
startBtn.onclick = async () => {
  try {
    // Request permission for video and audio
    localStream = await navigator.mediaDevices.getUserMedia({ 
      video: { width: 1280, height: 720 },
      audio: true 
    });
    // Display the stream in our local video tag
    localVideo.srcObject = localStream;
    
    // Update UI
    callBtn.disabled = false;
    startBtn.disabled = true;
  } catch (err) {
    console.error("Camera error:", err);
    alert("Could not access camera/microphone. Please check permissions.");
  }
};

// ==========================================
// 2. MAKE A CALL (CALLER)
// ==========================================
callBtn.onclick = () => {
  // Initialize the WebRTC connection
  pc = new RTCPeerConnection({ iceServers });
  
  // Update UI
  hangupBtn.disabled = false;
  callBtn.disabled = true;
  
  // Add our camera/mic tracks to the connection
  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
  });
  
  // Listen for the remote user's video stream
  pc.ontrack = event => {
    remoteVideo.srcObject = event.streams[0];
  };
  
  // As WebRTC finds network paths (ICE), send them to the other user via Socket.io
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) {
      socket.emit('candidate', candidate);
    }
  };
  
  // Create an Offer, set it as our local description, and send it to the server
  pc.createOffer()
    .then(offer => pc.setLocalDescription(offer))
    .then(() => socket.emit('offer', pc.localDescription))
    .catch(err => console.error("Offer error:", err));
};

// ==========================================
// 3. RECEIVE A CALL (CALLEE)
// ==========================================
function handleIncomingOffer(offer) {
  // Store the offer temporarily and show the custom alert UI
  currentOffer = offer;
  incomingCallDiv.classList.remove('hidden');
}

// ==========================================
// 4. ACCEPT A CALL (CALLEE)
// ==========================================
acceptBtn.onclick = async () => {
  if (!currentOffer) return;
  
  incomingCallDiv.classList.add('hidden'); // Hide the alert
  
  // If the user hasn't started their camera yet, start it now
  if (!localStream) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localVideo.srcObject = localStream;
      startBtn.disabled = true;
    } catch (err) {
      alert("Could not start camera for the call");
      return;
    }
  }
  
  // Initialize the WebRTC connection
  pc = new RTCPeerConnection({ iceServers });
  hangupBtn.disabled = false;
  
  // Add our local media tracks
  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream); 
  });
  
  // Listen for the remote user's video stream
  pc.ontrack = event => {
    remoteVideo.srcObject = event.streams[0];
  };
  
  // Send our network routing info to the caller
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit('candidate', candidate);
  };
  
  // Process the caller's Offer, generate an Answer, and send it back
  try {
    await pc.setRemoteDescription(currentOffer);   // Acknowledge their setup
    const answer = await pc.createAnswer();        // Create our setup
    await pc.setLocalDescription(answer);          // Save our setup
    socket.emit('answer', answer);                 // Send our setup to them
  } catch (err) {
    console.error("Answer error:", err);
  }
  
  currentOffer = null; // Clear the temporary offer
};

// ==========================================
// 5. REJECT A CALL
// ==========================================
rejectBtn.onclick = () => {
  currentOffer = null;
  incomingCallDiv.classList.add('hidden');
};

// ==========================================
// 6. PROCESS THE ANSWER (CALLER)
// ==========================================
function handleAnswer(answer) {
  // The Callee accepted. We apply their Answer to complete the handshake.
  if (pc) {
    pc.setRemoteDescription(answer);
  }
}

// ==========================================
// 7. PROCESS ICE CANDIDATES (BOTH)
// ==========================================
function handleCandidate(candidate) {
  // Add network routing information received from the other peer
  if (pc) {
    pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error(e));
  }
}

// ==========================================
// 8. END THE CALL
// ==========================================
hangupBtn.onclick = () => {
  // Close the WebRTC connection
  if (pc) {
    pc.close();
    pc = null;
  }
  
  // Remove remote video
  remoteVideo.srcObject = null;
  
  // Stop the camera/mic hardware completely
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
    localVideo.srcObject = null; 
  }
  
  // Reset buttons and UI
  hangupBtn.disabled = true;
  callBtn.disabled = true;
  startBtn.disabled = false; 
  incomingCallDiv.classList.add('hidden');
  currentOffer = null;
};

// --- Cleanup ---
window.onbeforeunload = () => {
  socket.disconnect();
  if (pc) pc.close();
};

