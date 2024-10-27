let APP_ID = "f6b2486500ad447fbefaf99c1fe021a8";
let token = null;
let uid = String(Math.floor(Math.random() * 10000));

let client;
let channel;

let queryString = window.location.search;
let urlParams = new URLSearchParams(queryString);
let roomId = urlParams.get('room');
let username = urlParams.get('username') || 'Anonymous';

let isHost = false;
let isWaitingForApproval = false;
let members = {};

if(!roomId){
    window.location = 'lobby.html';
}

let localStream;
let remoteStream;
let peerConnection;

const servers = {
    iceServers: [
        {
            urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302']
        }
    ]
};

let init = async () => {
    client = await AgoraRTM.createInstance(APP_ID);
    await client.login({ uid, token });
   
    channel = client.createChannel(roomId);
    await channel.join();

    const memberCount = await channel.getMembers();
    isHost = memberCount.length === 1;
    
    if (isHost) {
        document.getElementById('host-badge').style.display = 'block';
    } else {
        await requestToJoin();
    }

    document.getElementById('local-user-label').textContent = username;
    
    channel.on('MemberJoined', handleUserJoined);
    channel.on('MemberLeft', handleUserLeft);
    client.on('MessageFromPeer', handleMessageFromPeer);
   
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById('User-1').srcObject = localStream;
};

let showModal = (username) => {
    const modal = document.getElementById('join-request-modal');
    const usernameSpan = document.getElementById('requesting-username');
    usernameSpan.textContent = username;
    modal.style.display = 'block';
};

let hideModal = () => {
    const modal = document.getElementById('join-request-modal');
    modal.style.display = 'none';
};

let showWaitingMessage = () => {
    const waitingMessage = document.getElementById('waiting-message');
    waitingMessage.style.display = 'block';
};

let hideWaitingMessage = () => {
    const waitingMessage = document.getElementById('waiting-message');
    waitingMessage.style.display = 'none';
};

let requestToJoin = async () => {
    if (!isHost) {
        showWaitingMessage();
        isWaitingForApproval = true;
        
        const members = await channel.getMembers();
        const hostId = members[0];
        
        client.sendMessageToPeer({
            text: JSON.stringify({
                type: 'join-request',
                username: username
            })
        }, hostId);
    }
};

let handleMessageFromPeer = async (message, memberId) => {
    message = JSON.parse(message.text);
    
    if (message.type === 'join-request' && isHost) {
        showModal(message.username);
        
        members[memberId] = {
            username: message.username,
            pending: true
        };

        const acceptButton = document.getElementById('accept-btn');
        const rejectButton = document.getElementById('reject-btn');

        const handleAccept = () => {
            client.sendMessageToPeer({
                text: JSON.stringify({
                    type: 'join-approved',
                    username: username
                })
            }, memberId);
            hideModal();
            createOffer(memberId);
            // Remove event listeners
            acceptButton.removeEventListener('click', handleAccept);
            rejectButton.removeEventListener('click', handleReject);
        };

        const handleReject = () => {
            client.sendMessageToPeer({
                text: JSON.stringify({
                    type: 'join-rejected'
                })
            }, memberId);
            hideModal();
            // Remove event listeners
            acceptButton.removeEventListener('click', handleAccept);
            rejectButton.removeEventListener('click', handleReject);
        };

        // Add event listeners
        acceptButton.addEventListener('click', handleAccept);
        rejectButton.addEventListener('click', handleReject);
    }
    
    if (message.type === 'join-approved') {
        hideWaitingMessage();
        isWaitingForApproval = false;
        document.getElementById('remote-user-label').textContent = message.username;
    }
    
    if (message.type === 'join-rejected') {
        hideWaitingMessage();
        setTimeout(() => {
            alert('Your join request was rejected');
            window.location = 'lobby.html';
        }, 300);
    }
    
    if (message.type === 'offer' && !isWaitingForApproval) {
        createAnswer(memberId, message.offer);
    }
   
    if (message.type === 'answer') {
        addAnswer(message.answer);
    }
   
    if (message.type === 'candidate') {
        if (peerConnection) {
            peerConnection.addIceCandidate(message.candidate);
        }
    }
};


let handleUserJoined = async (memberId) => {
    console.log('A new user joined the channel:', memberId);
    if (isHost && !members[memberId]?.pending) {
        createOffer(memberId);
    }
};

let handleUserLeft = (memberId) => {
    document.getElementById('User-2').style.display = 'none';
    document.getElementById('User-1').classList.remove('smallframe');
    document.getElementById('remote-user-label').textContent = '';
    delete members[memberId];
}

// Rest of your existing functions remain the same
let createPeerConnection = async (memberId) => {
    peerConnection = new RTCPeerConnection(servers);

    remoteStream = new MediaStream();
    document.getElementById('User-2').srcObject = remoteStream;
    document.getElementById('User-2').style.display = 'block';
    document.getElementById('User-2').classList.add('active');

    document.getElementById('User-1').classList.add('smallframe');

    if (!localStream) {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById('User-1').srcObject = localStream;
    }

    localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = (event) => {
        event.streams[0].getTracks().forEach((track) => {
            remoteStream.addTrack(track);
        });
    };

    peerConnection.onicecandidate = async (event) => {
        if (event.candidate) {
            client.sendMessageToPeer({
                text: JSON.stringify({ 'type': 'candidate', 'candidate': event.candidate })
            }, memberId);
        }
    };
};

// Your existing functions remain the same
let createOffer = async (memberId) => {
    await createPeerConnection(memberId);
   
    let offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
   
    client.sendMessageToPeer({
        text: JSON.stringify({ 'type': 'offer', 'offer': offer })
    }, memberId);
};

let createAnswer = async (memberId, offer) => {
    await createPeerConnection(memberId);
   
    await peerConnection.setRemoteDescription(offer);
   
    let answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    client.sendMessageToPeer({
        text: JSON.stringify({ 'type': 'answer', 'answer': answer })
    }, memberId);
};

let addAnswer = async (answer) => {
    if (!peerConnection.currentRemoteDescription) {
        peerConnection.setRemoteDescription(answer);
    }
};

let leaveChannel = async () => {
    await channel.leave();
    await client.logout();
};

let toggleCamera = async () => {
    let videoTrack = localStream.getTracks().find(track => track.kind === 'video');
    if (videoTrack.enabled) {
        videoTrack.enabled = false;
        document.getElementById('camera-btn').style.backgroundColor = 'rgb(255, 80, 80)';
    } else {
        videoTrack.enabled = true;
        document.getElementById('camera-btn').style.backgroundColor = 'rgb(179, 102, 249, .9)';
    }
};

let toggleMic = async () => {
    let audioTrack = localStream.getTracks().find(track => track.kind === 'audio');
    if (audioTrack.enabled) {
        audioTrack.enabled = false;
        document.getElementById('mic-btn').style.backgroundColor = 'rgb(255, 80, 80)';
    } else {
        audioTrack.enabled = true;
        document.getElementById('mic-btn').style.backgroundColor = 'rgb(179, 102, 249, .9)';
    }
};

window.addEventListener('beforeunload', leaveChannel);
document.getElementById('camera-btn').addEventListener('click', toggleCamera);
document.getElementById('mic-btn').addEventListener('click', toggleMic);

init();
