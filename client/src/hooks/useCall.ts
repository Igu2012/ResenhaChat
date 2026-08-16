import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { beginNativeCallSession, endNativeCallSession, isNativeRuntime, requestNativeCallOverlayPermission, requestNativeMediaPermission, setNativeCallOverlayVisible, startNativeScreenCapture, type NativeScreenCapture, updateNativeCallSession } from "@/lib/nativeRuntime";

type CallProfile = { id: string; displayName: string; avatarUrl: string | null };
type RemotePeer = { socketId: string; stream: MediaStream; profile: CallProfile; sharingScreen: boolean };
type SignalPayload = {
  from: string;
  signal: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit | null };
  profile: CallProfile;
};

export type IncomingCall = { room: string; caller: { id: string; displayName: string; avatarUrl: string | null }; withVideo: boolean };

const rtcConfiguration: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
  iceCandidatePoolSize: 4,
};

function isMobileDevice() {
  return typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export function useCall(socket: Socket | null) {
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const pendingCandidatesRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const streamRef = useRef<MediaStream | null>(null);
  const roomRef = useRef<string | null>(null);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const facingModeRef = useRef<"user" | "environment">("user");
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const nativeScreenCaptureRef = useRef<NativeScreenCapture | null>(null);
  const screenSharingPeersRef = useRef(new Set<string>());
  const liveAudienceRef = useRef<string[]>([]);
  const ringtoneRef = useRef<number | null>(null);
  const titleAlertRef = useRef<number | null>(null);
  const originalTitleRef = useRef(typeof document === "undefined" ? "Resenha Chat" : document.title);
  const audioContextRef = useRef<AudioContext | null>(null);
  const [room, setRoom] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([]);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [outgoingCall, setOutgoingCall] = useState(false);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [sharingScreen, setSharingScreen] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<"user" | "environment">("user");
  const [switchingCamera, setSwitchingCamera] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nativeCallState = useCallback(() => ({
    title: sharingScreen ? "Compartilhando a tela" : "Chamada em andamento",
    participants: remotePeers.length + 1,
    participantLabel: remotePeers.length ? remotePeers.map(peer => peer.profile.displayName).slice(0, 2).join(", ") : "Aguardando alguém entrar",
    cameraActive: !cameraOff,
    sharingScreen,
  }), [cameraOff, remotePeers.length, sharingScreen]);

  useEffect(() => {
    if (!room || !isNativeRuntime()) return;
    void beginNativeCallSession(nativeCallState());
    return () => { void endNativeCallSession(); };
  // A sessão é iniciada uma vez; alterações posteriores são sincronizadas separadamente.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  useEffect(() => {
    if (!room || !isNativeRuntime()) return;
    void updateNativeCallSession(nativeCallState());
  }, [nativeCallState, room]);

  useEffect(() => {
    if (!room || !isNativeRuntime()) return;
    const syncOverlay = () => {
      const hidden = document.visibilityState !== "visible";
      void setNativeCallOverlayVisible(hidden);
      if (!hidden) setMinimized(false);
    };
    syncOverlay();
    document.addEventListener("visibilitychange", syncOverlay);
    return () => {
      document.removeEventListener("visibilitychange", syncOverlay);
    };
  }, [room]);

  const stopRingtone = useCallback(() => {
    if (ringtoneRef.current !== null) window.clearInterval(ringtoneRef.current);
    ringtoneRef.current = null;
  }, []);

  const stopIncomingAlert = useCallback(() => {
    stopRingtone();
    if (titleAlertRef.current !== null) window.clearInterval(titleAlertRef.current);
    titleAlertRef.current = null;
    document.title = originalTitleRef.current;
  }, [stopRingtone]);

  const playRingtone = useCallback(() => {
    stopRingtone();
    const tone = () => {
      try {
        const AudioContextCtor = window.AudioContext;
        const context = audioContextRef.current || new AudioContextCtor();
        audioContextRef.current = context;
        void context.resume();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.setValueAtTime(760, context.currentTime);
        gain.gain.setValueAtTime(0.0001, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.42);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.45);
      } catch {
        // Alguns navegadores bloqueiam áudio automático até a primeira interação do usuário.
      }
    };
    tone();
    ringtoneRef.current = window.setInterval(tone, 1400);
  }, [stopRingtone]);

  const startIncomingAlert = useCallback((callerName: string) => {
    stopIncomingAlert();
    let highlighted = false;
    const title = `${callerName} está ligando`;
    document.title = `☎ ${title}`;
    titleAlertRef.current = window.setInterval(() => {
      highlighted = !highlighted;
      document.title = highlighted ? `☎ ${title}` : "Resenha Chat";
    }, 950);
    navigator.vibrate?.([220, 90, 220, 90, 420]);
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Chamada recebida", { body: `${callerName} está ligando para você.`, tag: "resenha-incoming-call" });
    }
    playRingtone();
  }, [playRingtone, stopIncomingAlert]);

  const dropPeer = useCallback((socketId: string) => {
    peersRef.current.get(socketId)?.close();
    peersRef.current.delete(socketId);
    pendingCandidatesRef.current.delete(socketId);
    screenSharingPeersRef.current.delete(socketId);
    setRemotePeers(current => current.filter(peer => peer.socketId !== socketId));
  }, []);

  const endCall = useCallback(() => {
    stopIncomingAlert();
    if (roomRef.current) socket?.emit("call:media-state", { room: roomRef.current, sharingScreen: false });
    socket?.emit("call:leave");
    peersRef.current.forEach(peer => peer.close());
    peersRef.current.clear();
    pendingCandidatesRef.current.clear();
    void nativeScreenCaptureRef.current?.stop();
    nativeScreenCaptureRef.current = null;
    screenTrackRef.current?.stop();
    streamRef.current?.getTracks().forEach(track => track.stop());
    screenTrackRef.current = null;
    streamRef.current = null;
    roomRef.current = null;
    cameraTrackRef.current = null;
    liveAudienceRef.current = [];
    setRemotePeers([]);
    setLocalStream(null);
    setRoom(null);
    setIncomingCall(null);
    setOutgoingCall(false);
    setMuted(false);
    setCameraOff(false);
    setSharingScreen(false);
    setCameraFacing("user");
    setMinimized(false);
  }, [socket, stopIncomingAlert]);

  const ensureOverlayPermission = useCallback(async () => {
    if (!isNativeRuntime()) return true;
    const result = await requestNativeCallOverlayPermission();
    if (result.overlayAllowed) return true;
    setError("Para entrar na chamada, permita ‘Aparecer sobre outros apps’ e volte para a Resenha Chat.");
    return false;
  }, []);

  const activeTracks = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return [] as MediaStreamTrack[];
    const audio = stream.getAudioTracks();
    const video = screenTrackRef.current ? [screenTrackRef.current] : cameraTrackRef.current ? [cameraTrackRef.current] : [];
    return [...audio, ...video];
  }, []);

  const sendDescription = useCallback(async (peer: RTCPeerConnection, socketId: string) => {
    const activeRoom = roomRef.current;
    if (!socket || !activeRoom) return;
    const description = await peer.createOffer();
    await peer.setLocalDescription(description);
    socket.emit("call:signal", { room: activeRoom, to: socketId, signal: { description: peer.localDescription } });
  }, [socket]);

  const captureCamera = useCallback(async (facingMode: "user" | "environment", preferredDeviceId?: string, requireFacing = false) => {
    const idealVideo: MediaTrackConstraints = {
      ...(preferredDeviceId ? { deviceId: { exact: preferredDeviceId } } : isMobileDevice() ? { facingMode: { exact: facingMode } } : { facingMode: { ideal: facingMode } }),
      width: { ideal: 1280, max: 1920 },
      height: { ideal: 720, max: 1080 },
      frameRate: { ideal: 24, max: 30 },
    };
    try {
      return await navigator.mediaDevices.getUserMedia({ video: idealVideo, audio: false });
    } catch (primaryError) {
      if (requireFacing) throw primaryError;
      try {
        return await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facingMode } }, audio: false });
      } catch {
        return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
    }
  }, []);

  const publishCameraTrack = useCallback(async (nextTrack: MediaStreamTrack) => {
    const stream = streamRef.current;
    if (!stream) return;
    const previousTrack = cameraTrackRef.current;
    if (previousTrack && previousTrack.id !== nextTrack.id) stream.removeTrack(previousTrack);
    if (!stream.getVideoTracks().some(track => track.id === nextTrack.id)) stream.addTrack(nextTrack);
    cameraTrackRef.current = nextTrack;
    for (const [socketId, peer] of Array.from(peersRef.current.entries())) {
      const sender = peer.getSenders().find(item => item.track?.kind === "video");
      if (sender) await sender.replaceTrack(nextTrack);
      else {
        peer.addTrack(nextTrack, stream);
        await sendDescription(peer, socketId);
      }
    }
    if (!screenTrackRef.current) setLocalStream(new MediaStream([...stream.getAudioTracks(), nextTrack]));
    if (previousTrack && previousTrack.id !== nextTrack.id) previousTrack.stop();
  }, [sendDescription]);

  const createPeer = useCallback(async (socketId: string, profile: CallProfile, makeOffer: boolean) => {
    if (!socket || !streamRef.current) return;
    let peer = peersRef.current.get(socketId);
    if (peer) return peer;
    peer = new RTCPeerConnection(rtcConfiguration);
    peersRef.current.set(socketId, peer);
    activeTracks().forEach(track => peer!.addTrack(track, streamRef.current!));
    peer.onicecandidate = event => {
      const activeRoom = roomRef.current;
      if (event.candidate && activeRoom) socket.emit("call:signal", { room: activeRoom, to: socketId, signal: { candidate: event.candidate.toJSON() } });
    };
    peer.ontrack = event => {
      const stream = event.streams[0] || new MediaStream([event.track]);
      setRemotePeers(current => {
        const existing = current.find(item => item.socketId === socketId);
        const combined = existing?.stream || stream;
        if (!combined.getTracks().some(track => track.id === event.track.id)) combined.addTrack(event.track);
        return [...current.filter(item => item.socketId !== socketId), { socketId, stream: combined, profile, sharingScreen: screenSharingPeersRef.current.has(socketId) }];
      });
    };
    peer.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(peer!.connectionState)) dropPeer(socketId);
    };
    if (makeOffer) await sendDescription(peer, socketId);
    return peer;
  }, [activeTracks, dropPeer, sendDescription, socket]);

  const joinRoomWithMedia = useCallback(async (nextRoom: string, withVideo: boolean) => {
    if (!socket) throw new Error("A conexão em tempo real ainda não está disponível.");
    let stream: MediaStream;
    let cameraEnabled = withVideo;
    const audioConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    const nativePermission = await requestNativeMediaPermission({ camera: withVideo, microphone: true });
    if (!nativePermission.microphone) throw new Error("Permita o microfone nas configurações do Android para entrar na chamada.");
    if (withVideo && !nativePermission.camera) {
      cameraEnabled = false;
      setError("A câmera não foi permitida. A chamada continuará somente com áudio; toque no botão de câmera para tentar novamente.");
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: cameraEnabled ? { facingMode: { ideal: facingModeRef.current }, width: { ideal: 1280, max: 1920 }, height: { ideal: 720, max: 1080 }, frameRate: { ideal: 24, max: 30 } } : false,
      });
    } catch (error) {
      if (!cameraEnabled) throw error;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
        cameraEnabled = false;
        setError("A câmera foi recusada pelo Android ou pelo WebView. A chamada continuará somente com áudio.");
      } catch {
        const name = error instanceof DOMException ? error.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") throw new Error("Permita o microfone para entrar na chamada. A câmera pode ser ativada depois.");
        throw error;
      }
    }
    streamRef.current = stream;
    cameraTrackRef.current = stream.getVideoTracks()[0] || null;
    const capturedFacing = cameraTrackRef.current?.getSettings().facingMode;
    if (capturedFacing === "user" || capturedFacing === "environment") {
      facingModeRef.current = capturedFacing;
      setCameraFacing(capturedFacing);
    }
    roomRef.current = nextRoom;
    setLocalStream(stream);
    setRoom(nextRoom);
    setCameraOff(!cameraEnabled);
    await new Promise<void>((resolve, reject) => {
      socket.emit("call:join", { room: nextRoom }, (result: { ok: boolean; message?: string }) => {
        if (result.ok) resolve();
        else reject(new Error(result.message || "Não foi possível entrar na chamada."));
      });
    });
    return cameraEnabled;
  }, [socket]);

  useEffect(() => {
    if (!socket) return;
    const onSignal = async ({ from, signal, profile }: SignalPayload) => {
      const activeRoom = roomRef.current;
      if (!streamRef.current || !activeRoom) return;
      try {
        let peer = peersRef.current.get(from);
        if (!peer) peer = await createPeer(from, profile, false);
        if (!peer) return;
        if (signal.description) {
          await peer.setRemoteDescription(signal.description);
          const queued = pendingCandidatesRef.current.get(from) || [];
          for (const candidate of queued) await peer.addIceCandidate(candidate);
          pendingCandidatesRef.current.delete(from);
          if (signal.description.type === "offer") {
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            socket.emit("call:signal", { room: activeRoom, to: from, signal: { description: peer.localDescription } });
          }
        }
        if (signal.candidate) {
          if (peer.remoteDescription) await peer.addIceCandidate(signal.candidate);
          else pendingCandidatesRef.current.set(from, [...(pendingCandidatesRef.current.get(from) || []), signal.candidate]);
        }
      } catch {
        setError("A conexão da chamada falhou. Tente entrar novamente.");
      }
    };
    const updatePeerSharing = (socketId: string, sharingScreen: boolean) => {
      if (sharingScreen) screenSharingPeersRef.current.add(socketId);
      else screenSharingPeersRef.current.delete(socketId);
      setRemotePeers(current => current.map(peer => peer.socketId === socketId ? { ...peer, sharingScreen } : peer));
    };
    const onPeerJoined = ({ socketId, profile }: { socketId: string; profile: CallProfile }) => { void createPeer(socketId, profile, true); };
    const onPeerLeft = ({ socketId }: { socketId: string }) => dropPeer(socketId);
    const onMediaState = ({ socketId, sharingScreen }: { socketId: string; sharingScreen: boolean }) => updatePeerSharing(socketId, sharingScreen);
    const onMediaStates = ({ peers }: { peers: Array<{ socketId: string; sharingScreen: boolean }> }) => peers.forEach(peer => updatePeerSharing(peer.socketId, peer.sharingScreen));
    const onIncoming = (invite: IncomingCall) => {
      if (roomRef.current) return;
      setIncomingCall(invite);
      startIncomingAlert(invite.caller.displayName);
    };
    const onDeclined = ({ profile }: { profile: { displayName: string } }) => {
      setError(`${profile.displayName} recusou a chamada.`);
      endCall();
    };
    socket.on("call:signal", onSignal);
    socket.on("call:peer-joined", onPeerJoined);
    socket.on("call:peer-left", onPeerLeft);
    socket.on("call:media-state", onMediaState);
    socket.on("call:media-states", onMediaStates);
    socket.on("call:incoming", onIncoming);
    socket.on("call:declined", onDeclined);
    return () => {
      socket.off("call:signal", onSignal);
      socket.off("call:peer-joined", onPeerJoined);
      socket.off("call:peer-left", onPeerLeft);
      socket.off("call:media-state", onMediaState);
      socket.off("call:media-states", onMediaStates);
      socket.off("call:incoming", onIncoming);
      socket.off("call:declined", onDeclined);
    };
  }, [createPeer, dropPeer, endCall, socket, startIncomingAlert]);

  useEffect(() => () => endCall(), [endCall]);

  const startCall = useCallback(async (nextRoom: string, recipientIds: string[], withVideo: boolean, notifyRecipients = true, liveAudienceIds: string[] = []) => {
    if (!socket) return setError("A conexão em tempo real ainda não está disponível.");
    try {
      setError(null);
      if (!(await ensureOverlayPermission())) return;
      liveAudienceRef.current = liveAudienceIds;
      const cameraEnabled = await joinRoomWithMedia(nextRoom, withVideo);
      if (!notifyRecipients) {
        setOutgoingCall(false);
        return;
      }
      socket.emit("call:invite", { room: nextRoom, recipientIds, withVideo: cameraEnabled }, (result: { ok: boolean; message?: string }) => {
        if (!result.ok) {
          setError(result.message || "Ninguém recebeu o convite de chamada.");
          endCall();
          return;
        }
        setOutgoingCall(true);
      });
    } catch (reason) {
      endCall();
      setError(reason instanceof Error ? reason.message : "Permita o acesso ao microfone e à câmera para iniciar a chamada.");
    }
  }, [endCall, ensureOverlayPermission, joinRoomWithMedia, socket]);

  const acceptIncomingCall = useCallback(async () => {
    const invite = incomingCall;
    if (!invite) return;
    try {
      stopIncomingAlert();
      setIncomingCall(null);
      setError(null);
      if (!(await ensureOverlayPermission())) return;
      await joinRoomWithMedia(invite.room, invite.withVideo);
    } catch (reason) {
      endCall();
      setError(reason instanceof Error ? reason.message : "Permita o acesso ao microfone e à câmera para atender.");
    }
  }, [endCall, ensureOverlayPermission, incomingCall, joinRoomWithMedia, stopIncomingAlert]);

  const declineIncomingCall = useCallback(() => {
    if (incomingCall) socket?.emit("call:decline", { callerId: incomingCall.caller.id, room: incomingCall.room });
    stopIncomingAlert();
    setIncomingCall(null);
  }, [incomingCall, socket, stopIncomingAlert]);

  const toggleMute = useCallback(() => {
    streamRef.current?.getAudioTracks().forEach(track => { track.enabled = !track.enabled; });
    setMuted(value => !value);
  }, []);

  const toggleCamera = useCallback(async () => {
    if (sharingScreen || !streamRef.current) return;
    const track = cameraTrackRef.current;
    if (!track || track.readyState === "ended") {
      try {
        const permission = await requestNativeMediaPermission({ camera: true, microphone: false });
        if (!permission.camera) throw new Error("Permita a câmera nas configurações do Android para ativar o vídeo.");
        const cameraStream = await captureCamera(facingModeRef.current);
        const nextTrack = cameraStream.getVideoTracks()[0];
        if (!nextTrack) throw new Error("Nenhuma câmera foi encontrada.");
        await publishCameraTrack(nextTrack);
        setCameraOff(false);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Não foi possível iniciar a câmera. Verifique a permissão nas configurações do Android.");
      }
      return;
    }
    track.enabled = !track.enabled;
    setCameraOff(!track.enabled);
  }, [captureCamera, publishCameraTrack, sharingScreen]);

  const switchCamera = useCallback(async () => {
    if (sharingScreen || !streamRef.current || switchingCamera) return;
    setSwitchingCamera(true);
    const mobile = isMobileDevice();
    const previousTrack = cameraTrackRef.current;
    const previousFacingMode = facingModeRef.current;
    try {
      const nextFacingMode = previousFacingMode === "user" ? "environment" : "user";
      let cameraStream: MediaStream;
      if (mobile) {
        // Em diversos navegadores móveis, a lente oposta só fica disponível depois
        // que a faixa atual é interrompida de fato.
        previousTrack?.stop();
        await new Promise(resolve => window.setTimeout(resolve, 120));
        cameraStream = await captureCamera(nextFacingMode, undefined, true);
      } else {
        const cameras = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === "videoinput");
        if (cameras.length < 2) throw new Error("Apenas uma câmera está disponível.");
        const currentDeviceId = cameraTrackRef.current?.getSettings().deviceId;
        const currentIndex = Math.max(0, cameras.findIndex(camera => camera.deviceId === currentDeviceId));
        cameraStream = await captureCamera(nextFacingMode, cameras[(currentIndex + 1) % cameras.length]?.deviceId);
      }
      const nextTrack = cameraStream.getVideoTracks()[0];
      if (!nextTrack) throw new Error("Nenhuma câmera foi encontrada.");
      const nextFacing = nextTrack.getSettings().facingMode;
      if (mobile && nextFacing && nextFacing !== nextFacingMode) {
        nextTrack.stop();
        throw new Error("O navegador manteve a mesma câmera.");
      }
      facingModeRef.current = nextFacing === "user" || nextFacing === "environment" ? nextFacing : nextFacingMode;
      setCameraFacing(facingModeRef.current);
      await publishCameraTrack(nextTrack);
      setCameraOff(false);
    } catch {
      if (mobile && previousTrack) {
        try {
          const restoredStream = await captureCamera(previousFacingMode);
          const restoredTrack = restoredStream.getVideoTracks()[0];
          if (restoredTrack) await publishCameraTrack(restoredTrack);
        } catch {
          setCameraOff(true);
        }
      }
      setError("Não foi possível trocar de câmera neste dispositivo.");
    } finally {
      setSwitchingCamera(false);
    }
  }, [captureCamera, publishCameraTrack, sharingScreen, switchingCamera]);

  const stopSharing = useCallback(async () => {
    const cameraTrack = cameraTrackRef.current;
    for (const peer of Array.from(peersRef.current.values())) {
      const sender = peer.getSenders().find(item => item.track?.kind === "video");
      if (sender) await sender.replaceTrack(cameraTrack || null);
    }
    const nativeCapture = nativeScreenCaptureRef.current;
    nativeScreenCaptureRef.current = null;
    if (nativeCapture) await nativeCapture.stop();
    screenTrackRef.current?.stop();
    screenTrackRef.current = null;
    if (streamRef.current) setLocalStream(streamRef.current);
    setSharingScreen(false);
    if (roomRef.current) socket?.emit("call:media-state", { room: roomRef.current, sharingScreen: false });
  }, [socket]);

  const shareScreen = useCallback(async () => {
    if (!streamRef.current) return;
    if (isMobileDevice() && !isNativeRuntime()) {
      setError("O compartilhamento de tela está disponível apenas em computadores.");
      return;
    }
    const nativeMobileCapture = isMobileDevice() && isNativeRuntime();
    if (!nativeMobileCapture && !navigator.mediaDevices?.getDisplayMedia) {
      setError("Esta versão da APK não oferece captura de tela. Atualize o Android System WebView e tente novamente.");
      return;
    }
    try {
      const nativeCapture = nativeMobileCapture ? await startNativeScreenCapture() : null;
      const screenStream = nativeCapture?.stream || await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { max: 20 } }, audio: true });
      const screenTrack = screenStream.getVideoTracks()[0];
      if (!screenTrack) return;
      for (const [socketId, peer] of Array.from(peersRef.current.entries())) {
        const sender = peer.getSenders().find(item => item.track?.kind === "video");
        if (sender) await sender.replaceTrack(screenTrack);
        else {
          peer.addTrack(screenTrack, streamRef.current);
          await sendDescription(peer, socketId);
        }
      }
      nativeScreenCaptureRef.current = nativeCapture;
      screenTrackRef.current = screenTrack;
      setLocalStream(new MediaStream([...streamRef.current.getAudioTracks(), screenTrack]));
      setSharingScreen(true);
      if (roomRef.current) socket?.emit("call:media-state", { room: roomRef.current, sharingScreen: true, recipientIds: liveAudienceRef.current });
      screenTrack.onended = () => { void stopSharing(); };
    } catch {
      setError(isNativeRuntime() ? "O compartilhamento de tela foi cancelado ou bloqueado pelo Android." : "O compartilhamento de tela foi cancelado ou bloqueado pelo navegador.");
    }
  }, [sendDescription, socket, stopSharing]);

  const minimizeCall = useCallback(async () => {
    if (!isNativeRuntime()) return;
    setMinimized(true);
    await setNativeCallOverlayVisible(true);
  }, []);

  return { room, localStream, remotePeers, incomingCall, outgoingCall, muted, cameraOff, sharingScreen, cameraFacing, switchingCamera, minimized, error, startCall, acceptIncomingCall, declineIncomingCall, endCall, toggleMute, toggleCamera, switchCamera, shareScreen, stopSharing, minimizeCall };
}
