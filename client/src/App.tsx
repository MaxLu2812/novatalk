import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import {
  acceptRequest,
  createGroup,
  fetchBootstrap,
  fetchMessages,
  login,
  register,
  rejectRequest,
  saveProfile,
  sendFriendRequest,
  sendMessage,
  uploadConversationAvatar,
  uploadMyAvatar,
} from "./api";
import type { Bootstrap, Conversation, Message } from "./types";
import "./styles.css";

const TOKEN_KEY = "novatalk-token";

type Theme = "light" | "dark";
type ModalView = "profile" | "settings" | "chats" | "group" | null;
type CallState = "idle" | "calling" | "live";
type CropPurpose = "user-avatar" | "group-avatar";

type CropDraft = {
  purpose: CropPurpose;
  file: File;
  previewUrl: string;
  offsetX: number;
  offsetY: number;
  zoom: number;
};

type IncomingCall = {
  conversationId: string;
  fromUserId: string;
  fromName: string;
};

type RemoteParticipant = {
  userId: string;
  name: string;
  stream: MediaStream | null;
  muted: boolean;
  cameraOff: boolean;
};

function formatClock(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function IconButton({
  label,
  onClick,
  active,
  variant = "ghost",
  type = "button",
}: {
  label: string;
  onClick?: () => void;
  active?: boolean;
  variant?: "ghost" | "danger" | "accept" | "muted";
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      className={`icon-button ${variant}${active ? " active" : ""}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function Avatar({
  name,
  src,
  size = "md",
}: {
  name: string;
  src: string | null;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  return src ? (
    <img className={`avatar avatar-${size}`} src={src} alt={name} />
  ) : (
    <div className={`avatar avatar-${size} avatar-fallback`}>{name.slice(0, 1).toUpperCase()}</div>
  );
}

function VideoTile({
  title,
  stream,
  muted,
  participant,
}: {
  title: string;
  stream: MediaStream | null;
  muted?: boolean;
  participant?: RemoteParticipant;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="video-tile">
      <div className="video-tile-meta">
        <span>{title}</span>
        {participant ? (
          <small>
            {participant.muted ? "Muted" : "Mic on"} | {participant.cameraOff ? "Cam off" : "Cam on"}
          </small>
        ) : null}
      </div>
      <video ref={ref} autoPlay playsInline muted={muted} />
    </div>
  );
}

function VoiceMessage({
  src,
}: {
  src: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTime = () => setCurrentTime(audio.currentTime);
    const handleLoaded = () => setDuration(audio.duration || 0);
    const handleEnded = () => {
      setPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener("timeupdate", handleTime);
    audio.addEventListener("loadedmetadata", handleLoaded);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("timeupdate", handleTime);
      audio.removeEventListener("loadedmetadata", handleLoaded);
      audio.removeEventListener("ended", handleEnded);
    };
  }, []);

  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play();
      setPlaying(true);
    } else {
      audio.pause();
      setPlaying(false);
    }
  }

  function handleSeek(event: ChangeEvent<HTMLInputElement>) {
    const audio = audioRef.current;
    if (!audio) return;
    const nextTime = Number(event.target.value);
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      className="voice-message"
      onContextMenu={(event) => event.preventDefault()}
      onDragStart={(event) => event.preventDefault()}
    >
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        controlsList="nodownload noplaybackrate noremoteplayback"
        style={{ display: "none" }}
      />
      <button className="voice-play" type="button" onClick={togglePlayback}>
        {playing ? "⏸" : "▶"}
      </button>
      <div className={`voice-wave${playing ? " playing" : ""}`} aria-hidden="true">
        <span /><span /><span /><span /><span /><span />
      </div>
      <div className="voice-progress-track" onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const pct = x / rect.width;
        const audio = audioRef.current;
        if (audio && duration > 0) {
          audio.currentTime = pct * duration;
        }
      }}>
        <div className="voice-progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="voice-time">
        <span>{formatClock(currentTime)}</span>
      </div>
    </div>
  );
}

function createCroppedSquareBlob(crop: CropDraft) {
  return new Promise<Blob>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      const size = 640;
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Could not prepare canvas."));
        return;
      }

      const drawWidth = image.width * crop.zoom;
      const drawHeight = image.height * crop.zoom;
      const x = (size - drawWidth) / 2 + crop.offsetX;
      const y = (size - drawHeight) / 2 + crop.offsetY;
      context.drawImage(image, x, y, drawWidth, drawHeight);
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Could not export avatar."));
          return;
        }
        resolve(blob);
      }, "image/jpeg", 0.94);
    };
    image.onerror = () => reject(new Error("Could not load image."));
    image.src = crop.previewUrl;
  });
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) ?? "");
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [activeConversationId, setActiveConversationId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("register");
  const [authForm, setAuthForm] = useState({ displayName: "", username: "", password: "" });
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("novatalk-theme") as Theme) || "dark");
  const [themeTransitioning, setThemeTransitioning] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeModal, setActiveModal] = useState<ModalView>(null);
  const [settingsForm, setSettingsForm] = useState({ displayName: "", bio: "" });
  const [friendUsername, setFriendUsername] = useState("");
  const [groupTitle, setGroupTitle] = useState("");
  const [selectedGroupMembers, setSelectedGroupMembers] = useState<string[]>([]);
  const [pendingGroupAvatar, setPendingGroupAvatar] = useState<File | null>(null);
  const [cropDraft, setCropDraft] = useState<CropDraft | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [callTrayOpen, setCallTrayOpen] = useState(false);
  const [activeCallConversationId, setActiveCallConversationId] = useState("");
  const [callState, setCallState] = useState<CallState>("idle");
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteParticipants, setRemoteParticipants] = useState<RemoteParticipant[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const recordingStartedAtRef = useRef<number>(0);
  const recordChunksRef = useRef<Blob[]>([]);

  const currentUser = bootstrap?.currentUser ?? null;
  const conversations = bootstrap?.conversations ?? [];
  const activeConversation =
    conversations.find((conversation) => conversation.id === activeConversationId) ?? conversations[0] ?? null;
  const isGroupConversation = activeConversation?.kind === "group";
  const canCall = Boolean(activeConversation);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("novatalk-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!themeTransitioning) return;
    const timer = window.setTimeout(() => setThemeTransitioning(false), 650);
    return () => window.clearTimeout(timer);
  }, [themeTransitioning]);

  useEffect(() => {
    if (!error && !info) return;
    const timer = window.setTimeout(() => {
      setError("");
      setInfo("");
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [error, info]);

  useEffect(() => {
    if (!token) return;
    fetchBootstrap(token)
      .then((data) => {
        setBootstrap(data);
        setSettingsForm({
          displayName: data.currentUser.displayName,
          bio: data.currentUser.bio ?? "",
        });
        setActiveConversationId((current) => current || data.conversations[0]?.id || "");
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setToken("");
      });
  }, [token]);

  useEffect(() => {
    if (!socketRef.current || !bootstrap) return;
    socketRef.current.emit("conversations:sync", {
      conversationIds: bootstrap.conversations.map((conversation) => conversation.id),
    });
  }, [bootstrap]);

  useEffect(() => {
    if (!token) return;

    const socket = io("http://localhost:3001", {
      auth: { token },
    });
    socketRef.current = socket;

    socket.on("message:new", ({ conversationId, message }: { conversationId: string; message: Message }) => {
      setBootstrap((current) =>
        current
          ? {
              ...current,
              conversations: current.conversations
                .map((conversation) =>
                  conversation.id === conversationId
                    ? {
                        ...conversation,
                        lastMessagePreview: message.text || message.fileName || `[${message.type}]`,
                        updatedAt: message.createdAt,
                      }
                    : conversation,
                )
                .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
            }
          : current,
      );
      if (conversationId === activeConversationId) {
        setMessages((current) => [...current, message]);
      }
    });

    socket.on("friends:updated", async () => {
      const data = await fetchBootstrap(token);
      setBootstrap(data);
    });

    socket.on("conversations:updated", async () => {
      const data = await fetchBootstrap(token);
      setBootstrap(data);
    });

    socket.on("conversation:updated", async () => {
      const data = await fetchBootstrap(token);
      setBootstrap(data);
    });

    socket.on(
      "call:invite",
      ({ conversationId, fromUserId, fromName }: { conversationId: string; fromUserId: string; fromName: string }) => {
        if (fromUserId === currentUser?.id) return;
        setIncomingCall({ conversationId, fromUserId, fromName });
        setCallTrayOpen(true);
        setInfo(`Incoming call from ${fromName}`);
      },
    );

    socket.on(
      "call:invite-response",
      async ({ conversationId, accepted }: { conversationId: string; accepted: boolean }) => {
        if (conversationId !== activeCallConversationId) return;
        if (!accepted) {
          setInfo("Call declined.");
          await cleanupLocalCall(false);
        }
      },
    );

    socket.on(
      "call:participant-joined",
      async ({
        conversationId,
        userId,
        displayName,
      }: {
        conversationId: string;
        userId: string;
        displayName: string;
      }) => {
        if (userId === currentUser?.id) return;
        setRemoteParticipants((current) =>
          current.some((participant) => participant.userId === userId)
            ? current
            : [...current, { userId, name: displayName, stream: null, muted: false, cameraOff: false }],
        );
        if (activeCallConversationId === conversationId && callState !== "idle") {
          await createPeerOffer(userId, conversationId, displayName);
        }
      },
    );

    socket.on(
      "call:signal",
      async ({
        conversationId,
        fromUserId,
        signal,
      }: {
        conversationId: string;
        fromUserId: string;
        signal: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
      }) => {
        if (fromUserId === currentUser?.id) return;
        const peer = await ensurePeerConnection(fromUserId, conversationId, false);
        if (signal.description) {
          await peer.setRemoteDescription(signal.description);
          if (signal.description.type === "offer") {
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            socket.emit("call:signal", {
              conversationId,
              toUserId: fromUserId,
              signal: { description: answer },
            });
            setCallState("live");
          }
        }
        if (signal.candidate) {
          await peer.addIceCandidate(signal.candidate);
        }
      },
    );

    socket.on(
      "call:state",
      ({
        fromUserId,
        muted,
        cameraOff,
      }: {
        fromUserId: string;
        muted: boolean;
        cameraOff: boolean;
      }) => {
        setRemoteParticipants((current) =>
          current.map((participant) =>
            participant.userId === fromUserId ? { ...participant, muted, cameraOff } : participant,
          ),
        );
      },
    );

    socket.on(
      "call:leave",
      async ({ userId }: { userId: string }) => {
        removePeer(userId);
        setRemoteParticipants((current) => current.filter((participant) => participant.userId !== userId));
        if (peerConnectionsRef.current.size === 0) {
          await cleanupLocalCall(false);
          setInfo("Call ended.");
        }
      },
    );

    socket.on(
      "call:end",
      async ({ conversationId }: { conversationId: string }) => {
        if (incomingCall?.conversationId === conversationId) {
          setIncomingCall(null);
        }
        if (activeCallConversationId === conversationId) {
          await cleanupLocalCall(false);
          setInfo("Call cancelled.");
        }
      },
    );

    return () => {
      socket.disconnect();
    };
  }, [token, activeConversationId, currentUser?.id, activeCallConversationId, callState, incomingCall?.conversationId]);

  useEffect(() => {
    if (!token || !activeConversation?.id) return;
    fetchMessages(token, activeConversation.id).then(setMessages).catch(() => setMessages([]));
  }, [token, activeConversation?.id]);

  const activeConversationMembers = useMemo(() => activeConversation?.members ?? [], [activeConversation]);

  function getConversationTitle(conversationId: string) {
    return conversations.find((conversation) => conversation.id === conversationId)?.title ?? "Conversation";
  }

  function getMemberName(userId: string, conversation?: Conversation | null) {
    const source = conversation ?? activeConversation;
    return source?.members.find((member) => member.id === userId)?.displayName ?? "Guest";
  }

  function revokeCropPreview(draft: CropDraft | null) {
    if (draft) {
      URL.revokeObjectURL(draft.previewUrl);
    }
  }

  function toggleTheme() {
    setThemeTransitioning(true);
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }

  async function refreshBootstrap() {
    if (!token) return;
    const data = await fetchBootstrap(token);
    setBootstrap(data);
    setActiveConversationId((current) => current || data.conversations[0]?.id || "");
  }

  async function handleAuthSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const response =
        authMode === "register"
          ? await register(authForm)
          : await login({ username: authForm.username, password: authForm.password });
      localStorage.setItem(TOKEN_KEY, response.token);
      setToken(response.token);
      setBootstrap(response.bootstrap);
      setSettingsForm({
        displayName: response.bootstrap.currentUser.displayName,
        bio: response.bootstrap.currentUser.bio ?? "",
      });
      setActiveConversationId(response.bootstrap.conversations[0]?.id ?? "");
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Auth failed");
    }
  }

  async function handleSendMessage(event: FormEvent) {
    event.preventDefault();
    if (!token || !activeConversation || !draft.trim()) return;
    await sendMessage(token, activeConversation.id, { text: draft.trim(), type: "text" });
    setDraft("");
  }

  async function handleFilePicked(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !token || !activeConversation) return;
    await sendMessage(token, activeConversation.id, {
      file,
      type: file.type.startsWith("image/") ? "image" : "file",
    });
    event.target.value = "";
  }

  async function startVoiceRecording() {
    if (!token || !activeConversation) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    recordChunksRef.current = [];
    recordingStartedAtRef.current = Date.now();
    setRecordingSeconds(0);
    setRecording(true);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordChunksRef.current.push(event.data);
      }
    };
    recorder.onstop = async () => {
      const blob = new Blob(recordChunksRef.current, { type: "audio/webm" });
      await sendMessage(token, activeConversation.id, {
        file: blob,
        type: "voice",
        fileName: `voice-${Date.now()}.webm`,
      });
      stream.getTracks().forEach((track) => track.stop());
      recorderRef.current = null;
      if (recordingTimerRef.current) {
        window.clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      setRecording(false);
      setRecordingSeconds(0);
      setInfo("Voice message sent.");
    };
    recorder.start();
    recorderRef.current = recorder;
    recordingTimerRef.current = window.setInterval(() => {
      setRecordingSeconds(Math.floor((Date.now() - recordingStartedAtRef.current) / 1000));
    }, 250);
  }

  async function handleVoiceRecord() {
    if (!recorderRef.current) {
      await startVoiceRecording();
      return;
    }
    recorderRef.current.stop();
  }

  async function handleSendFriendRequest(event: FormEvent) {
    event.preventDefault();
    if (!token || !friendUsername.trim()) return;
    try {
      const data = await sendFriendRequest(token, friendUsername.trim());
      setBootstrap(data);
      setFriendUsername("");
      setInfo("Request sent.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to send request");
    }
  }

  async function handleAcceptRequest(requestId: string) {
    if (!token) return;
    const data = await acceptRequest(token, requestId);
    setBootstrap(data);
  }

  async function handleRejectRequest(requestId: string) {
    if (!token) return;
    const data = await rejectRequest(token, requestId);
    setBootstrap(data);
  }

  async function handleSaveSettings(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    const data = await saveProfile(token, settingsForm);
    setBootstrap(data);
    setInfo("Settings saved.");
    setActiveModal(null);
  }

  function openCropModal(file: File, purpose: CropPurpose) {
    const previewUrl = URL.createObjectURL(file);
    setCropDraft({
      purpose,
      file,
      previewUrl,
      offsetX: 0,
      offsetY: 0,
      zoom: 1,
    });
  }

  function handleAvatarSelection(event: ChangeEvent<HTMLInputElement>, purpose: CropPurpose) {
    const file = event.target.files?.[0];
    if (!file) return;
    openCropModal(file, purpose);
    event.target.value = "";
  }

  async function applyCrop() {
    if (!cropDraft || !token) return;
    try {
      const blob = await createCroppedSquareBlob(cropDraft);
      const croppedFile = new File([blob], "avatar.jpg", { type: "image/jpeg" });
      if (cropDraft.purpose === "user-avatar") {
        const data = await uploadMyAvatar(token, croppedFile);
        setBootstrap(data);
        setInfo("Avatar updated.");
      } else {
        setPendingGroupAvatar(croppedFile);
        setInfo("Group avatar ready.");
      }
      revokeCropPreview(cropDraft);
      setCropDraft(null);
    } catch (cropError) {
      setError(cropError instanceof Error ? cropError.message : "Could not crop image.");
    }
  }

  function closeCropModal() {
    revokeCropPreview(cropDraft);
    setCropDraft(null);
  }

  async function handleCreateGroup(event: FormEvent) {
    event.preventDefault();
    if (!token || !groupTitle.trim() || selectedGroupMembers.length === 0) return;
    const conversation = await createGroup(token, {
      title: groupTitle.trim(),
      memberIds: selectedGroupMembers,
    });
    if (pendingGroupAvatar) {
      await uploadConversationAvatar(token, conversation.id, pendingGroupAvatar);
    }
    await refreshBootstrap();
    setGroupTitle("");
    setSelectedGroupMembers([]);
    setPendingGroupAvatar(null);
    setActiveConversationId(conversation.id);
    setActiveModal(null);
    setInfo("Group created.");
  }

  function openModal(view: Exclude<ModalView, null>) {
    setDrawerOpen(false);
    setActiveModal(view);
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setBootstrap(null);
    setMessages([]);
    setActiveConversationId("");
    setDrawerOpen(false);
    setActiveModal(null);
  }

  function applyLocalTrackState(stream: MediaStream, muted: boolean, cameraDisabled: boolean) {
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    stream.getVideoTracks().forEach((track) => {
      track.enabled = !cameraDisabled;
    });
  }

  async function ensureLocalCallStream() {
    if (localStream) {
      applyLocalTrackState(localStream, micMuted, cameraOff);
      return localStream;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    applyLocalTrackState(stream, micMuted, cameraOff);
    setLocalStream(stream);
    return stream;
  }

  function upsertRemoteParticipant(userId: string, name: string, stream: MediaStream | null) {
    setRemoteParticipants((current) => {
      const existing = current.find((participant) => participant.userId === userId);
      if (!existing) {
        return [...current, { userId, name, stream, muted: false, cameraOff: false }];
      }
      return current.map((participant) =>
        participant.userId === userId ? { ...participant, name, stream: stream ?? participant.stream } : participant,
      );
    });
  }

  function removePeer(userId: string) {
    const peer = peerConnectionsRef.current.get(userId);
    if (peer) {
      peer.close();
      peerConnectionsRef.current.delete(userId);
    }
  }

  async function ensurePeerConnection(
    remoteUserId: string,
    conversationId: string,
    initiator: boolean,
    remoteName?: string,
  ) {
    const existing = peerConnectionsRef.current.get(remoteUserId);
    if (existing) {
      return existing;
    }

    const stream = await ensureLocalCallStream();
    const peer = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    stream.getTracks().forEach((track) => peer.addTrack(track, stream));
    peer.ontrack = (event) => {
      upsertRemoteParticipant(
        remoteUserId,
        remoteName ?? getMemberName(remoteUserId, conversations.find((conversation) => conversation.id === conversationId)),
        event.streams[0],
      );
      setCallState("live");
    };
    peer.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit("call:signal", {
          conversationId,
          toUserId: remoteUserId,
          signal: { candidate: event.candidate.toJSON() },
        });
      }
    };
    peer.onconnectionstatechange = async () => {
      if (["disconnected", "failed", "closed"].includes(peer.connectionState)) {
        removePeer(remoteUserId);
        setRemoteParticipants((current) => current.filter((participant) => participant.userId !== remoteUserId));
        if (peerConnectionsRef.current.size === 0 && callState !== "calling") {
          await cleanupLocalCall(false);
        }
      }
    };

    peerConnectionsRef.current.set(remoteUserId, peer);

    if (initiator && socketRef.current) {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      socketRef.current.emit("call:signal", {
        conversationId,
        toUserId: remoteUserId,
        signal: { description: offer },
      });
    }

    return peer;
  }

  async function createPeerOffer(remoteUserId: string, conversationId: string, remoteName: string) {
    await ensurePeerConnection(remoteUserId, conversationId, true, remoteName);
  }

  async function cleanupLocalCall(notifyPeer: boolean) {
    const shouldCancel = notifyPeer && activeCallConversationId && callState === "calling" && remoteParticipants.length === 0;
    const shouldLeave = notifyPeer && activeCallConversationId && !shouldCancel;

    if (shouldCancel) {
      socketRef.current?.emit("call:end", { conversationId: activeCallConversationId });
    }
    if (shouldLeave) {
      socketRef.current?.emit("call:leave", { conversationId: activeCallConversationId });
    }

    peerConnectionsRef.current.forEach((peer) => peer.close());
    peerConnectionsRef.current.clear();
    localStream?.getTracks().forEach((track) => track.stop());
    setLocalStream(null);
    setRemoteParticipants([]);
    setMicMuted(false);
    setCameraOff(false);
    setCallState("idle");
    setActiveCallConversationId("");
    setCallTrayOpen(false);
  }

  async function startCall() {
    if (!activeConversation) return;
    await ensureLocalCallStream();
    setActiveCallConversationId(activeConversation.id);
    setCallState("calling");
    setCallTrayOpen(true);
    socketRef.current?.emit("call:invite", { conversationId: activeConversation.id });
    setInfo("Calling... everyone will be notified.");
  }

  async function acceptIncomingCall() {
    if (!incomingCall) return;
    await ensureLocalCallStream();
    setActiveConversationId(incomingCall.conversationId);
    setActiveCallConversationId(incomingCall.conversationId);
    setCallState("calling");
    setCallTrayOpen(true);
    socketRef.current?.emit("call:invite-response", {
      conversationId: incomingCall.conversationId,
      toUserId: incomingCall.fromUserId,
      accepted: true,
    });
    setIncomingCall(null);
  }

  function declineIncomingCall() {
    if (!incomingCall) return;
    socketRef.current?.emit("call:invite-response", {
      conversationId: incomingCall.conversationId,
      toUserId: incomingCall.fromUserId,
      accepted: false,
    });
    setIncomingCall(null);
  }

  async function endCall() {
    await cleanupLocalCall(true);
  }

  function toggleMute() {
    const nextMuted = !micMuted;
    setMicMuted(nextMuted);
    if (localStream) {
      localStream.getAudioTracks().forEach((track) => {
        try { track.enabled = !nextMuted; } catch { /* ignore */ }
      });
    }
    if (activeCallConversationId && socketRef.current) {
      socketRef.current.emit("call:state", {
        conversationId: activeCallConversationId,
        muted: nextMuted,
        cameraOff,
      });
    }
    setInfo(nextMuted ? "Mic muted" : "Mic unmuted");
  }

  function toggleCamera() {
    const nextCameraOff = !cameraOff;
    setCameraOff(nextCameraOff);
    if (localStream) {
      localStream.getVideoTracks().forEach((track) => {
        track.enabled = !nextCameraOff;
      });
    }
    if (activeCallConversationId) {
      socketRef.current?.emit("call:state", {
        conversationId: activeCallConversationId,
        muted: micMuted,
        cameraOff: nextCameraOff,
      });
    }
  }

  if (!token || !bootstrap) {
    return (
      <div className="auth-shell">
        <div className="auth-card floating">
          <div className="auth-copy">
            <span className="eyebrow">NovaTalk</span>
            <h1>Cleaner messenger, softer motion, sharper flow.</h1>
            <p>
              Sign up with a display name and unique <code>@username</code>, add friends, create groups,
              send files and voice notes, and jump into calls.
            </p>
          </div>

          <form className="auth-form" onSubmit={handleAuthSubmit}>
            <div className="segment">
              <button type="button" className={authMode === "register" ? "active" : ""} onClick={() => setAuthMode("register")}>
                Register
              </button>
              <button type="button" className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")}>
                Login
              </button>
            </div>

            {authMode === "register" ? (
              <label>
                Display name
                <input
                  value={authForm.displayName}
                  onChange={(event) => setAuthForm({ ...authForm, displayName: event.target.value })}
                  placeholder="Alex Parker"
                />
              </label>
            ) : null}

            <label>
              Username
              <input
                value={authForm.username}
                onChange={(event) => setAuthForm({ ...authForm, username: event.target.value.toLowerCase() })}
                placeholder="alex_parker"
              />
            </label>

            <label>
              Password
              <input
                type="password"
                value={authForm.password}
                onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })}
                placeholder="password"
              />
            </label>

            {error ? <p className="feedback error">{error}</p> : null}
            <button className="primary-button" type="submit">
              {authMode === "register" ? "Create account" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const viewer = bootstrap.currentUser;

  return (
    <>
      {themeTransitioning ? <div className="theme-overlay" /> : null}

      <div className="shell shell-app">
        <div className="left-zone">
          <aside className="icon-rail floating">
            <button className="rail-dot" onClick={() => setDrawerOpen((current) => !current)} title="Menu">
              ≡
            </button>
            <button className="rail-avatar active" onClick={() => setActiveModal("profile")} title="My Profile">
              <Avatar name={viewer.displayName} src={viewer.avatarUrl} size="md" />
            </button>
          </aside>

          <div className="left-panel-list">
            <div className="left-panel-label">Chats</div>
            {conversations.slice(0, 6).map((conversation) => (
              <button
                key={conversation.id}
                className={`left-panel-item${conversation.id === activeConversation?.id ? " active" : ""}`}
                onClick={() => setActiveConversationId(conversation.id)}
              >
                <Avatar name={conversation.title} src={conversation.avatarUrl} size="sm" />
                <span className="left-panel-item-name">{conversation.title}</span>
                <span className="left-panel-item-preview">{conversation.lastMessagePreview}</span>
              </button>
            ))}
            <div className="left-panel-label">Contacts</div>
            {bootstrap.friends.map((friend) => (
              <button
                key={friend.id}
                className="left-panel-item"
                onClick={() => {
                  const direct = conversations.find(
                    (c) => c.kind === "direct" && c.members.some((m) => m.id === friend.id),
                  );
                  if (direct) setActiveConversationId(direct.id);
                }}
              >
                <Avatar name={friend.displayName} src={friend.avatarUrl} size="sm" />
                <span className="left-panel-item-name">{friend.displayName}</span>
              </button>
            ))}
            <button className="left-panel-item" onClick={() => setActiveModal("settings")} style={{ opacity: 0.6, gap: "6px" }}>
              <span style={{ fontSize: "0.9rem", width: "22px", textAlign: "center", flexShrink: 0 }}>+</span>
              <span className="left-panel-item-name">Add Contact</span>
            </button>
          </div>
        </div>

        <main className="chat-panel floating">
          {activeConversation ? (
            <>
              <header className="chat-header">
                <div className="identity-row">
                  <Avatar name={activeConversation.title} src={activeConversation.avatarUrl} size="lg" />
                  <div>
                    <h1>{activeConversation.title}</h1>
                    <p>{activeConversation.subtitle}</p>
                  </div>
                </div>
                <div className="header-meta" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span>{activeConversation.kind === "group" ? "Group" : "Direct"}</span>
                  {canCall ? (
                    <button
                      className={`call-btn-top${callState === "live" ? " live" : ""}`}
                      onClick={() => {
                        if (callState === "idle") {
                          setCallTrayOpen((current) => !current);
                        } else {
                          setCallTrayOpen((current) => !current);
                        }
                      }}
                      title={callState === "idle" ? "Call" : "In call"}
                    >
                      {callState === "idle" ? "📞" : callState === "calling" ? "⏳" : "🔴"}
                    </button>
                  ) : null}
                </div>
              </header>

              <section className="messages">
                {messages.map((message) => (
                  <article key={message.id} className="message-row">
                    <Avatar name={message.sender.displayName} src={message.sender.avatarUrl} />
                    <div className="message-bubble">
                      <div className="message-meta">
                        <strong>{message.sender.displayName}</strong>
                        <span>{new Date(message.createdAt).toLocaleString()}</span>
                      </div>
                      {message.text ? <p>{message.text}</p> : null}
                      {message.type === "image" && message.fileUrl ? (
                        <img className="message-image" src={message.fileUrl} alt={message.fileName ?? "attachment"} />
                      ) : null}
                      {message.type === "voice" && message.fileUrl ? <VoiceMessage src={message.fileUrl} /> : null}
                      {message.type === "file" && message.fileUrl ? (
                        <a href={message.fileUrl} target="_blank" rel="noreferrer">
                          {message.fileName ?? "Open file"}
                        </a>
                      ) : null}
                    </div>
                  </article>
                ))}
              </section>

              {canCall && callTrayOpen ? (
                <div className="call-console-expanded floating" onClick={(e) => e.stopPropagation()}>
                  <div className="call-console-head" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <strong>{activeConversation?.title}</strong>
                      <p style={{ color: "var(--muted)", margin: "2px 0 0", fontSize: "0.82rem" }}>
                        {callState === "idle" ? "Ready" : callState === "calling" ? "Calling..." : "Live"}
                      </p>
                    </div>
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      <button className="ghost-button" style={{ padding: "4px 10px", fontSize: "0.8rem" }} onClick={() => setCallTrayOpen(false)}>✕</button>
                    </div>
                  </div>
                  {callState === "idle" ? (
                    <div style={{ textAlign: "center", padding: "12px 0" }}>
                      <p style={{ color: "var(--muted)", marginBottom: "10px", fontSize: "0.88rem" }}>Start a call with this conversation.</p>
                      <button className="primary-button" type="button" onClick={startCall}>Start call</button>
                    </div>
                  ) : (
                    <>
                      <div className="call-stage">
                        <VideoTile title="You" stream={localStream} muted />
                        {remoteParticipants.length > 0 ? (
                          remoteParticipants.map((p) => (
                            <VideoTile key={p.userId} title={p.name} stream={p.stream} participant={p} />
                          ))
                        ) : (
                          <div className="video-placeholder" style={{ textAlign: "center", padding: "16px" }}>
                            <span className="signal-pulse" />
                            <strong style={{ display: "block", marginTop: "6px", fontSize: "0.88rem" }}>Waiting...</strong>
                          </div>
                        )}
                      </div>
                      <div className="call-controls">
                        <IconButton label={micMuted ? "🔇 Muted" : "🎤 Mic"} onClick={toggleMute} active={micMuted} variant={micMuted ? "danger" : "ghost"} />
                        <IconButton label={cameraOff ? "📷 Off" : "📹 On"} onClick={toggleCamera} active={cameraOff} />
                        <IconButton label="❌ Leave" variant="danger" onClick={endCall} />
                      </div>
                    </>
                  )}
                </div>
              ) : null}

              <form className="composer-glass" onSubmit={handleSendMessage}>
                <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Write a message" />
                <input type="file" id="file-upload" hidden onChange={handleFilePicked} />
                <label className="ghost-button file-label" htmlFor="file-upload">
                  📎
                </label>
                {recording ? (
                  <div className="voice-recorder">
                    <span className="voice-recorder-dot" />
                    <span className="voice-recorder-timer">{formatClock(recordingSeconds)}</span>
                    <button type="button" className="voice-recorder-cancel" onClick={() => {
                      if (recorderRef.current) {
                        recorderRef.current.onstop = null;
                        recorderRef.current.stop();
                        recorderRef.current = null;
                      }
                      if (recordingTimerRef.current) {
                        window.clearInterval(recordingTimerRef.current);
                        recordingTimerRef.current = null;
                      }
                      if (recorderRef.current === null) {
                        setRecording(false);
                        setRecordingSeconds(0);
                      }
                    }}>Cancel</button>
                    <button className="primary-button" type="button" onClick={handleVoiceRecord} style={{ padding: "8px 16px" }}>
                      Send
                    </button>
                  </div>
                ) : (
                  <button className={`ghost-button${recording ? " recording" : ""}`} type="button" onClick={handleVoiceRecord} title="Voice message">
                    🎤
                  </button>
                )}
                <button className="primary-button" type="submit">
                  Send
                </button>
              </form>
            </>
          ) : (
            <div className="empty-state">
              <h1>Start with friends first.</h1>
              <p>Open chats from the left menu or accept a request to spawn a direct conversation.</p>
            </div>
          )}
        </main>
      </div>

      <div className={`mid-flyout-backdrop ${drawerOpen ? "open" : ""}`} onClick={() => setDrawerOpen(false)} />
      <aside className={`mid-flyout floating ${drawerOpen ? "open" : ""}`}>
        <div className="mid-flyout-section">
          <div className="mid-flyout-section-label">Account</div>
          <button className="mid-flyout-item" onClick={() => { openModal("profile"); setDrawerOpen(false); }}>
            <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <Avatar name={viewer.displayName} src={viewer.avatarUrl} size="md" />
              <span>
                <div style={{ fontSize: "0.9rem", fontWeight: 500 }}>{viewer.displayName}</div>
                <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>@{viewer.username}</div>
              </span>
            </span>
          </button>
          <button className="mid-flyout-item" onClick={() => { openModal("settings"); setDrawerOpen(false); }}>
            ⚙ Settings & Profile
          </button>
        </div>
        <div className="mid-flyout-section">
          <button className="mid-flyout-item" onClick={() => { openModal("group"); setDrawerOpen(false); }}>
            👥 Create Group
          </button>
        </div>
        <div className="mid-flyout-section">
          <button className="mid-flyout-item" onClick={toggleTheme}>
            🎨 {theme === "dark" ? "Dark" : "Light"} Theme
          </button>
          <button className="mid-flyout-item danger-text" onClick={logout}>
            🚪 Log Out
          </button>
        </div>
      </aside>

      {activeModal ? (
        <div className="center-modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="center-modal floating" onClick={(event) => event.stopPropagation()}>
            {activeModal === "chats" ? (
              <>
                <div className="section-head">
                  <strong>Conversations</strong>
                </div>
                <div className="modal-scroll">
                  {conversations.map((conversation) => (
                    <button
                      key={conversation.id}
                      className={conversation.id === activeConversation?.id ? "conversation-row active" : "conversation-row"}
                      onClick={() => {
                        setActiveConversationId(conversation.id);
                        setActiveModal(null);
                      }}
                    >
                      <Avatar name={conversation.title} src={conversation.avatarUrl} />
                      <div className="conversation-copy">
                        <strong>{conversation.title}</strong>
                        <p>{conversation.lastMessagePreview}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            {activeModal === "group" ? (
              <form className="section-card" onSubmit={handleCreateGroup}>
                <div className="section-head">
                  <strong>Create Group</strong>
                  {pendingGroupAvatar ? <span className="tiny-label">Avatar ready</span> : null}
                </div>
                <label>
                  Group name
                  <input value={groupTitle} onChange={(event) => setGroupTitle(event.target.value)} placeholder="Weekend Crew" />
                </label>
                <label className="file-pick">
                  Group avatar
                  <input type="file" accept="image/*" onChange={(event) => handleAvatarSelection(event, "group-avatar")} />
                </label>
                <div className="member-pills">
                  {bootstrap.friends.map((friend) => (
                    <button
                      type="button"
                      key={friend.id}
                      className={selectedGroupMembers.includes(friend.id) ? "pill active" : "pill"}
                      onClick={() =>
                        setSelectedGroupMembers((current) =>
                          current.includes(friend.id)
                            ? current.filter((id) => id !== friend.id)
                            : [...current, friend.id],
                        )
                      }
                    >
                      @{friend.username}
                    </button>
                  ))}
                </div>
                <button className="primary-button" type="submit">
                  Create group
                </button>
              </form>
            ) : null}

            {activeModal === "profile" ? (
              <div className="section-card">
                <div className="section-head">
                  <strong>My Profile</strong>
                </div>
                <div className="avatar-picker">
                  <div className="avatar-picker-icon">
                    <Avatar name={viewer.displayName} src={viewer.avatarUrl} size="xl" />
                  </div>
                  <div className="avatar-picker-contacts">
                    <div style={{ marginBottom: "8px" }}>
                      <h3 style={{ margin: 0 }}>{viewer.displayName}</h3>
                      <p style={{ color: "var(--muted)", margin: "2px 0" }}>@{viewer.username}</p>
                      <small style={{ color: "var(--muted)" }}>{viewer.bio || "No bio yet."}</small>
                    </div>
                    <label className="file-pick" style={{ fontSize: "0.85rem" }}>
                      📷 Change avatar
                      <input type="file" accept="image/*" onChange={(event) => handleAvatarSelection(event, "user-avatar")} />
                    </label>
                    <div style={{ marginTop: "8px", borderTop: "1px solid var(--line)", paddingTop: "8px" }}>
                      <small style={{ color: "var(--muted)", display: "block", marginBottom: "6px" }}>CONTACTS</small>
                      {bootstrap.friends.map((friend) => (
                        <button
                          key={friend.id}
                          className="avatar-picker-contact"
                          onClick={() => {
                            const direct = conversations.find(
                              (c) => c.kind === "direct" && c.members.some((m) => m.id === friend.id),
                            );
                            if (direct) {
                              setActiveConversationId(direct.id);
                              setActiveModal(null);
                            }
                          }}
                        >
                          <Avatar name={friend.displayName} src={friend.avatarUrl} size="sm" />
                          <div>
                            <div className="avatar-picker-contact-name">{friend.displayName}</div>
                            <div className="avatar-picker-contact-username">@{friend.username}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {activeModal === "settings" ? (
              <div className="section-card" style={{ maxHeight: "70vh", overflowY: "auto" }}>
                <form onSubmit={handleSaveSettings}>
                  <div className="section-head">
                    <strong>Settings</strong>
                  </div>
                  <label>
                    Display name
                    <input
                      value={settingsForm.displayName}
                      onChange={(event) => setSettingsForm({ ...settingsForm, displayName: event.target.value })}
                    />
                  </label>
                  <label>
                    Bio
                    <textarea
                      rows={3}
                      value={settingsForm.bio}
                      onChange={(event) => setSettingsForm({ ...settingsForm, bio: event.target.value })}
                    />
                  </label>
                  <button className="primary-button" type="submit" style={{ marginBottom: "16px" }}>
                    Save changes
                  </button>
                </form>

                <div style={{ borderTop: "1px solid var(--line)", paddingTop: "16px" }}>
                  <strong>Add friend</strong>
                  <form onSubmit={handleSendFriendRequest} style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                    <input
                      value={friendUsername}
                      onChange={(event) => setFriendUsername(event.target.value.toLowerCase())}
                      placeholder="friend_username"
                      style={{ flex: 1 }}
                    />
                    <button className="primary-button" type="submit" style={{ whiteSpace: "nowrap" }}>
                      Send
                    </button>
                  </form>
                </div>

                {bootstrap.incomingRequests.length > 0 ? (
                  <div style={{ borderTop: "1px solid var(--line)", paddingTop: "16px", marginTop: "16px" }}>
                    <strong>Incoming requests</strong>
                    {bootstrap.incomingRequests.map((request) => (
                      <div key={request.id} className="request-row" style={{ marginTop: "8px" }}>
                        <div className="identity-row">
                          <Avatar name={request.user.displayName} src={request.user.avatarUrl} />
                          <div>
                            <strong>{request.user.displayName}</strong>
                            <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.82rem" }}>@{request.user.username}</p>
                          </div>
                        </div>
                        <div className="inline-actions">
                          <IconButton label="Accept" onClick={() => handleAcceptRequest(request.id)} />
                          <IconButton label="Decline" variant="danger" onClick={() => handleRejectRequest(request.id)} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {incomingCall ? (
        <div className="call-modal">
          <div className="call-modal-card floating">
            <div className="call-modal-top">
              <span className="signal-pulse" />
              <p>Incoming call</p>
            </div>
            <h3>{incomingCall.fromName}</h3>
            <p>{getConversationTitle(incomingCall.conversationId)}</p>
            <div className="call-avatars">
              <div className="call-avatar-ring green">
                <Avatar name={incomingCall.fromName} src={null} size="xl" />
              </div>
              <div className="call-avatar-ring amber">
                <Avatar name={viewer.displayName} src={viewer.avatarUrl} size="xl" />
              </div>
            </div>
            <div className="call-modal-actions">
              <IconButton label="Decline" variant="danger" onClick={declineIncomingCall} />
              <IconButton label="Accept" variant="accept" onClick={acceptIncomingCall} />
            </div>
          </div>
        </div>
      ) : null}

      {cropDraft ? (
        <div className="crop-modal">
          <div className="crop-card floating">
            <div className="section-head">
              <strong>Choose avatar framing</strong>
            </div>
            <div className="avatar-lab">
              <div className="crop-preview-shell">
                <div className="crop-preview-circle">
                  <img
                    src={cropDraft.previewUrl}
                    alt="Crop preview"
                    style={{
                      transform: `translate(${cropDraft.offsetX}px, ${cropDraft.offsetY}px) scale(${cropDraft.zoom})`,
                    }}
                  />
                </div>
              </div>
              <div className="avatar-lab-side">
                <div className="mini-preview-ring">
                  <div className="mini-preview-circle">
                    <img
                      src={cropDraft.previewUrl}
                      alt="Mini preview"
                      style={{
                        transform: `translate(${cropDraft.offsetX * 0.45}px, ${cropDraft.offsetY * 0.45}px) scale(${cropDraft.zoom})`,
                      }}
                    />
                  </div>
                </div>
                <p className="helper-copy">Center the face and zoom until it feels right.</p>
              </div>
            </div>
            <label>
              Zoom
              <input
                type="range"
                min="1"
                max="2.6"
                step="0.01"
                value={cropDraft.zoom}
                onChange={(event) =>
                  setCropDraft((current) => (current ? { ...current, zoom: Number(event.target.value) } : current))
                }
              />
            </label>
            <label>
              Horizontal
              <input
                type="range"
                min="-220"
                max="220"
                step="1"
                value={cropDraft.offsetX}
                onChange={(event) =>
                  setCropDraft((current) => (current ? { ...current, offsetX: Number(event.target.value) } : current))
                }
              />
            </label>
            <label>
              Vertical
              <input
                type="range"
                min="-220"
                max="220"
                step="1"
                value={cropDraft.offsetY}
                onChange={(event) =>
                  setCropDraft((current) => (current ? { ...current, offsetY: Number(event.target.value) } : current))
                }
              />
            </label>
            <div className="inline-actions">
              <button className="ghost-button" type="button" onClick={closeCropModal}>
                Cancel
              </button>
              <button className="primary-button" type="button" onClick={applyCrop}>
                Apply avatar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {error ? <div className="toast error">{error}</div> : null}
      {info ? <div className="toast">{info}</div> : null}
    </>
  );
}
