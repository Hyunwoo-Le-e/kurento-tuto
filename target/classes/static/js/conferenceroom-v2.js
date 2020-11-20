/*
 * (C) Copyright 2014 Kurento (http://kurento.org/)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

var ws = new WebSocket('wss://' + location.host + '/groupcall');
var participants = {};
var name;
var videoStream;
var peerConnectionConfig = {
	iceServers: []
};

window.onbeforeunload = function() {
	ws.close();
};

ws.onmessage = function(message) {
	var parsedMessage = JSON.parse(message.data);
	console.info('Received message: ' + message.data);

	switch (parsedMessage.id) {
	case 'existingParticipants':
		onExistingParticipants(parsedMessage);
		break;
	case 'newParticipantArrived':
		onNewParticipant(parsedMessage);
		break;
	case 'participantLeft':
		onParticipantLeft(parsedMessage);
		break;
	case 'receiveVideoAnswer':
		receiveVideoResponse(parsedMessage);
		break;
	case 'iceCandidate':
		participants[parsedMessage.name].rtcPeer.addIceCandidate(new RTCIceCandidate(parsedMessage.candidate)).catch(e => console.log(e));
		// participants[parsedMessage.name].rtcPeer.addIceCandidate(parsedMessage.candidate, function (error) {
	    //     if (error) {
		//       console.error("Error adding candidate: " + error);
		//       return;
	    //     }
	    // });
	    break;
	default:
		console.error('Unrecognized message', parsedMessage);
	}
}

function register() {
	name = document.getElementById('name').value;
	var room = document.getElementById('roomName').value;

	document.getElementById('room-header').innerText = 'ROOM ' + room;
	document.getElementById('join').style.display = 'none';
	document.getElementById('room').style.display = 'block';

	var message = {
		id : 'joinRoom',
		name : name,
		room : room,
	}
	sendMessage(message);
}

function onNewParticipant(request) {
	receiveVideo(request.name);
}

function receiveVideoResponse(result) {
	// @@@@@
	var answer = new RTCSessionDescription({
		type: 'answer',
		sdp: result.sdpAnswer
	});
	participants[result.name].rtcPeer.setRemoteDescription(new RTCSessionDescription(answer)).catch(e => console.log(e));
	// participants[result.name].rtcPeer.processAnswer (result.sdpAnswer, function (error) {
	// 	if (error) return console.error (error);
	// });
}

function callResponse(message) {
	if (message.response != 'accepted') {
		console.info('Call not accepted by peer. Closing call');
		stop();
	} else {
		webRtcPeer.processAnswer(message.sdpAnswer, function (error) {
			if (error) return console.error (error);
		});
	}
}

function onExistingParticipants(msg) {
	var constraints = {
		audio : true,
		video : {
			mandatory : {
				maxWidth : 320,
				maxFrameRate : 30,
				minFrameRate : 30
			}
		}
	};
	console.log(name + " registered in room " + room);
	var participant = new Participant(name);
	participants[name] = participant;
	var video = participant.getVideoElement();

	var options = {
	      localVideo: video,
	      mediaConstraints: constraints,
	      onicecandidate: participant.onIceCandidate.bind(participant)
	    }

	navigator.mediaDevices.getUserMedia(constraints).then(function (stream) {

		video.srcObject = stream;
		video.muted = true;

		participant.rtcPeer = new RTCPeerConnection(peerConnectionConfig);
		if (!participant.rtcPeer.getLocalStreams && participant.rtcPeer.getSenders) {
			participant.rtcPeer.getLocalStreams = function () {
				var stream = new MediaStream();
				participant.rtcPeer.getSenders().forEach(function (sender) {
					stream.addTrack(sender.track);
				});
				return [stream];
			};
		}
		if (!participant.rtcPeer.getRemoteStreams && participant.rtcPeer.getReceivers) {
			participant.rtcPeer.getRemoteStreams = function () {
				var stream = new MediaStream();
				participant.rtcPeer.getReceivers().forEach(function (sender) {
					stream.addTrack(sender.track);
				});
				return [stream];
			};
		}
		participant.rtcPeer.getTransceivers().forEach(function (transceiver) {
			transceiver.direction = 'sendonly';
		});
		stream.getTracks().forEach(function (track) {
			participant.rtcPeer.addTrack(track, stream);
		});
		participant.rtcPeer.onicecandidate = function (event) {
			if( event.candidate != null ) {
				participant.onIceCandidate(event.candidate);
			}
		};
		participant.rtcPeer.createOffer().then(function (offer) {
			return participant.rtcPeer.setLocalDescription(offer);
		}).then(function () {
			var localDescription = participant.rtcPeer.localDescription;
			participant.offerToReceiveVideo(null, localDescription.sdp);
		});
	});

	// participant.rtcPeer = new kurentoUtils.WebRtcPeer.WebRtcPeerSendonly(options,
	// 	function (error) {
	// 	  if(error) {
	// 		  return console.error(error);
	// 	  }
	// 	  this.generateOffer (participant.offerToReceiveVideo.bind(participant));
	// });

	msg.data.forEach(receiveVideo);
}

function leaveRoom() {
	sendMessage({
		id : 'leaveRoom'
	});

	for ( var key in participants) {
		participants[key].dispose();
	}

	document.getElementById('join').style.display = 'block';
	document.getElementById('room').style.display = 'none';

	ws.close();
}

function receiveVideo(sender) {

	// name 이 master이거나 sender가 master일 경우에만 stream 받도록 제한 ( master는 모두를 볼 수 있고 master가 아닌 participant는 master만 볼 수 있도록 하기 위해 )
	if (name === 'master' || sender === 'master') {
		var participant = new Participant(sender);
		participants[sender] = participant;
		var video = participant.getVideoElement();

		var options = {
			remoteVideo: video,
			onicecandidate: participant.onIceCandidate.bind(participant)
		}

		participant.rtcPeer = new RTCPeerConnection(peerConnectionConfig);

		if (!participant.rtcPeer.getLocalStreams && participant.rtcPeer.getSenders) {
			participant.rtcPeer.getLocalStreams = function () {
				var stream = new MediaStream();
				participant.rtcPeer.getSenders().forEach(function (sender) {
					stream.addTrack(sender.track);
				});
				return [stream];
			};
		}
		if (!participant.rtcPeer.getRemoteStreams && participant.rtcPeer.getReceivers) {
			participant.rtcPeer.getRemoteStreams = function () {
				var stream = new MediaStream();
				participant.rtcPeer.getReceivers().forEach(function (sender) {
					stream.addTrack(sender.track);
				});
				return [stream];
			};
		}
		participant.rtcPeer.addTransceiver('audio', { direction: 'recvonly' });
		participant.rtcPeer.addTransceiver('video', { direction: 'recvonly' });

		participant.rtcPeer.ontrack = function (event) {
			video.srcObject = event.streams[0];
		};

		participant.rtcPeer.onicecandidate = function (event) {
			if( event.candidate != null ) {
				participant.onIceCandidate(event.candidate);
			}
		};

		participant.rtcPeer.createOffer().then(function (offer) {
			return participant.rtcPeer.setLocalDescription(offer);
		}).then(function () {
			var localDescription = participant.rtcPeer.localDescription;
			participant.offerToReceiveVideo(null, localDescription.sdp);
		});


		// participant.rtcPeer = new kurentoUtils.WebRtcPeer.WebRtcPeerRecvonly(options,
		// 	function (error) {
		// 		if(error) {
		// 			return console.error(error);
		// 		}
		// 		this.generateOffer (participant.offerToReceiveVideo.bind(participant));
		// 	});
	}
}

function onParticipantLeft(request) {
	console.log('Participant ' + request.name + ' left');
	var participant = participants[request.name];
	participant.dispose();
	delete participants[request.name];
}

function sendMessage(message) {
	var jsonMessage = JSON.stringify(message);
	console.log('Sending message: ' + jsonMessage);
	ws.send(jsonMessage);
}
