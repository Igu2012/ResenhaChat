import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCall } from "@/hooks/useCall";
import {
	  accountStoreForSwitch,
	  applyOfficialSession,
	  appendMessage,
  channelRoomId,
	  createConnectionCode,
	  createEmptyOrbitStore,
	  createId,
	  deleteMessagesByAuthor,
	  directRoomId,
	  migrateDirectRoomId,
	  readOfficialRefreshToken,
	  readAccountVault,
	  replaceProfileEverywhere,
	  readOrbitStore,
	  removeAccountSnapshot,
	  saveOfficialRefreshToken,
	  saveAccountSnapshot,
  type LocalAttachment,
  type LocalGroup,
  type LocalMessage,
  type LocalProfile,
	  type LocalAccountRecord,
	  type LocalRequest,
	  type OrbitStore,
	  migrateGuestToOfficial,
	  updateMessage,
	  upsertContact,
	  voiceRoomId,
	  writeOrbitStore,
	} from "@/lib/localOrbit";
	import { decryptMessageForRecipient, encryptMessageForRecipients, ensureEncryptionPublicKey, isEncryptedMessage } from "@/lib/e2ee";
		import { addNativeBackButtonListener, checkForUpdate, exitNativeApp, getLatestPlatformReleaseDownloads, getRuntimeServerOrigin, isNativeRuntime, markUpdateDownloadOffered, openUpdateDownload, registerNativePush, requestNativeNotificationPermission, runtimeApiUrl, shouldOpenUpdateDownload, subscribeNativePushProfile } from "@/lib/nativeRuntime";
		import { loginOfficialAccount, refreshOfficialAccount, registerOfficialAccount, type OfficialLogin } from "@/lib/accountSession";
		import { attachmentRetentionClass } from "@/lib/attachmentRetention";
		import { AUDIO_PRE_RECORD_DELAY_MS, shouldSendHeldAudio } from "@/lib/audioRecording";

	import { acceptsAttachmentSize, MAX_ATTACHMENT_BYTES } from "../../../shared/attachmentLimits";
	import { isValidPassword, isValidUsername, PASSWORD_HTML_PATTERN, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, passwordRuleMessage, passwordsMatch, USERNAME_HTML_PATTERN, USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, usernameRuleMessage } from "../../../shared/credentials";
	import { io, type Socket } from "socket.io-client";
	import { filterInvitableContacts } from "@shared/groupInvites";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Camera,
  Check,
  CornerUpLeft,
	  Copy,
	  Download,
	  Eye,
  EyeOff,
  FileIcon,
	  FolderPlus,
	  Forward,
  Hash,
  ImagePlus,
	  Loader2,
	  Link,
  Maximize2,
  Menu,
  Mic,
  MicOff,
  Minimize2,
  MonitorUp,
  MoreHorizontal,
	  Paperclip,
	  Pencil,
	  Pin,
  Phone,
  Plus,
  SendHorizontal,
  Settings,
  Smile,
  SwitchCamera,
  Trash2,
  UserPlus,
  Users,
  Video,
  VideoOff,
  Volume2,
  X,
} from "lucide-react";
import { toast } from "sonner";

type ActiveRoom = { kind: "dm" | "channel"; id: string; title: string; groupId?: string; partner?: LocalProfile };
type ObservedCall = { room: string; participants: LocalProfile[]; startedAt: number | null };
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
type MobileInstallPlatform = "android" | "ios";

const MAX_LOCAL_FILE_BYTES = MAX_ATTACHMENT_BYTES;
const APP_NAME = "Resenha Chat";

function initials(value: string) {
  return value.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "O";
}

function colorFor(value: string) {
  const colors = ["bg-emerald-500", "bg-lime-600", "bg-green-600", "bg-emerald-600", "bg-lime-500"];
  return colors[value.length % colors.length];
}

function ProfileAvatar({ profile, className = "h-9 w-9" }: { profile: Pick<LocalProfile, "displayName" | "avatarUrl">; className?: string }) {
  return <Avatar className={`${className} shrink-0 rounded-xl`}><AvatarImage key={profile.avatarUrl || "resenha-avatar"} src={profile.avatarUrl || undefined} /><AvatarFallback className={`${colorFor(profile.displayName)} text-xs font-bold text-white`}>{initials(profile.displayName)}</AvatarFallback></Avatar>;
}

function IconButton({ label, onClick, children, active = false, disabled = false, className = "" }: { label: string; onClick?: () => void; children: React.ReactNode; active?: boolean; disabled?: boolean; className?: string }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className={`grid h-9 w-9 place-items-center rounded-lg transition active:scale-95 ${active ? "bg-emerald-500 text-white" : "text-slate-400 hover:bg-white/[.07] hover:text-white"} disabled:cursor-not-allowed disabled:opacity-40 ${className}`}>{children}</button>;
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-40 grid place-items-center bg-slate-950/75 p-4 backdrop-blur-sm" onMouseDown={onClose}><div className="orbit-enter w-full max-w-md rounded-3xl border border-white/[.09] bg-[#1d2030] p-6 shadow-2xl" onMouseDown={event => event.stopPropagation()}>{children}</div></div>;
}

function fileAsAttachment(file: File): Promise<LocalAttachment> {
  return new Promise((resolve, reject) => {
    if (!acceptsAttachmentSize(file.size)) return reject(new Error("No modo local, o arquivo deve ter no máximo 15 MB."));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.onload = () => resolve({ name: file.name, mimeType: file.type || "application/octet-stream", size: file.size, dataUrl: String(reader.result) });
    reader.readAsDataURL(file);
  });
}

function isLocalAttachment(value: unknown): value is LocalAttachment {
  if (!value || typeof value !== "object") return false;
  const attachment = value as Partial<LocalAttachment>;
  return typeof attachment.name === "string" && typeof attachment.mimeType === "string" && typeof attachment.size === "number" && (typeof attachment.dataUrl === "string" || attachment.dataUrl === null);
}

function VideoTile({ stream, name, muted = false, mirrored = false, focused = false, screenShare = false, onFocus }: { stream: MediaStream; name: string; muted?: boolean; mirrored?: boolean; focused?: boolean; screenShare?: boolean; onFocus?: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return <button type="button" onClick={onFocus} className={`group relative overflow-hidden rounded-2xl bg-[#10121a] text-left transition duration-200 ${screenShare ? "min-h-[260px] ring-2 ring-rose-500/75 shadow-[0_0_0_5px_rgba(244,63,94,0.09)] sm:col-span-2" : "min-h-[160px] hover:ring-2 hover:ring-violet-400/70"}`}><video ref={ref} autoPlay playsInline muted={muted} className={`h-full w-full object-cover ${mirrored ? "-scale-x-100" : ""}`} />{screenShare && <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-md bg-rose-500 px-2 py-1 text-[10px] font-black tracking-[.12em] text-white shadow-lg"><i className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />LIVE</span>}<span className="absolute bottom-3 left-3 rounded-md bg-slate-950/70 px-2 py-1 text-xs font-semibold text-white">{name}</span><span className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg bg-slate-950/70 text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100"><Maximize2 size={16} /></span></button>;
}

function FullscreenVideo({ stream, name, muted = false, mirrored = false, screenShare = false, onMinimize }: { stream: MediaStream; name: string; muted?: boolean; mirrored?: boolean; screenShare?: boolean; onMinimize: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return <section className="fixed inset-0 z-[70] bg-black" aria-label={`Visualização ampliada de ${name}`}><video ref={ref} autoPlay playsInline muted={muted} className={`h-full w-full object-contain ${mirrored ? "-scale-x-100" : ""}`} /><div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent p-4 sm:p-6"><div className="flex items-center gap-2"><span className="rounded-lg bg-black/60 px-3 py-1.5 text-sm font-semibold text-white">{name}</span>{screenShare && <span className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500 px-2.5 py-1.5 text-[11px] font-black tracking-[.12em] text-white"><i className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />LIVE</span>}</div><button type="button" onClick={onMinimize} className="inline-flex h-10 items-center gap-2 rounded-xl bg-black/65 px-3 text-sm font-bold text-white shadow-lg transition hover:bg-black/85 active:scale-95" aria-label="Minimizar vídeo ampliado"><Minimize2 size={18} />Minimizar</button></div><button type="button" onClick={onMinimize} className="absolute inset-0 -z-10" aria-label="Voltar à chamada normal" /></section>;
}

function CallPresenceBadge({ call, currentProfile }: { call: ReturnType<typeof useCall>; currentProfile: LocalProfile }) {
  if (!call.room) return null;
  const participants = [currentProfile, ...call.remotePeers.map(peer => peer.profile)];
  return <div className="flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-2 py-1" title={`${participants.length} participante(s) na chamada`}><div className="flex -space-x-2">{participants.map(participant => <span key={participant.id} className="relative"><ProfileAvatar profile={participant} className="h-6 w-6 border-2 border-[#1a1d28]" /><i className="absolute bottom-0 right-0 h-2 w-2 rounded-full border border-[#1a1d28] bg-emerald-400" /></span>)}</div><span className="text-[11px] font-bold text-emerald-200"><span className="sm:hidden">{participants.length}</span><span className="hidden sm:inline">{participants.length} na call</span></span></div>;
}

function ObservedCallBadge({ activeCall }: { activeCall: ObservedCall }) {
  const visibleParticipants = activeCall.participants.slice(0, 4);
  return <div className="flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-2 py-1" title={`${activeCall.participants.length} participante(s) na chamada`}><div className="flex -space-x-2">{visibleParticipants.map(participant => <span key={participant.id} className="relative"><ProfileAvatar profile={participant} className="h-6 w-6 border-2 border-[#1a1d28]" /><i className="absolute bottom-0 right-0 h-2 w-2 rounded-full border border-[#1a1d28] bg-emerald-400" /></span>)}</div><span className="text-[11px] font-bold text-emerald-200"><span className="sm:hidden">{activeCall.participants.length}</span><span className="hidden sm:inline">{activeCall.participants.length} na call</span></span></div>;
}

function ActiveCallCard({ activeCall, joined, onJoin, onRestore }: { activeCall: ObservedCall; joined: boolean; onJoin: () => void; onRestore?: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const elapsedSeconds = activeCall.startedAt ? Math.max(0, Math.floor((now - activeCall.startedAt) / 1_000)) : 0;
  const duration = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:${String(elapsedSeconds % 60).padStart(2, "0")}`;
  return <article className="mx-4 mt-4 flex items-center gap-3 rounded-2xl border border-emerald-400/25 bg-gradient-to-r from-emerald-500/15 to-cyan-500/10 p-3 shadow-[0_10px_28px_rgba(16,185,129,.08)] sm:mx-6"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500 text-white shadow-lg shadow-emerald-500/20"><Phone size={19} /></span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="text-sm font-bold text-emerald-100">Ligação em andamento</p><span className="rounded-md bg-emerald-400/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-200">{duration}</span></div><div className="mt-1 flex items-center gap-2"><div className="flex -space-x-1.5">{activeCall.participants.slice(0, 4).map(participant => <ProfileAvatar key={participant.id} profile={participant} className="h-5 w-5 border-2 border-[#19322e]" />)}</div><p className="truncate text-[11px] text-emerald-100/70">{activeCall.participants.map(participant => participant.displayName).join(", ")} {activeCall.participants.length === 1 ? "está na call" : "estão na call"}</p></div></div>{joined ? <button type="button" onClick={onRestore} className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-bold text-emerald-100 transition hover:bg-emerald-400/15">Abrir call</button> : <Button onClick={onJoin} className="h-9 shrink-0 rounded-xl bg-emerald-500 px-3 text-xs font-bold text-white hover:bg-emerald-400"><Phone size={15} />Entrar</Button>}</article>;
}

function linkifyMessage(text: string) {
  const parts = text.split(/(https?:\/\/[^\s<]+)/gi);
  return parts.map((part, index) => {
    if (!/^https?:\/\//i.test(part)) return part;
    const match = part.match(/^(.*?)([),.!?;:]*)$/);
    const url = match?.[1] || part;
    const punctuation = match?.[2] || "";
    return <span key={`${url}-${index}`}><a href={url} target="_blank" rel="noreferrer noopener" className="font-medium text-sky-400 underline decoration-sky-400/40 underline-offset-2 transition hover:text-sky-300 hover:decoration-sky-300">{url}</a>{punctuation}</span>;
  });
}

function messagePreview(message: LocalMessage) {
  if (message.body) return message.body.slice(0, 140);
  if (message.attachment?.mimeType.startsWith("audio/")) return "Enviou uma mensagem de áudio";
  if (message.attachment?.mimeType.startsWith("image/")) return "Enviou uma imagem";
  if (message.attachment) return `Enviou ${message.attachment.name}`;
  return "Nova mensagem";
}

function notifyIncomingMessage(sender: LocalProfile, message: LocalMessage) {
  toast.info(`${sender.displayName}: ${messagePreview(message)}`);
  notifyBackgroundActivity(`Nova mensagem de ${sender.displayName}`, messagePreview(message), `resenha-message-${message.id}`);
}

function notifyBackgroundActivity(title: string, body: string, tag: string) {
  if (document.visibilityState === "visible") return;
  document.title = `• ${title}`;
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body, tag });
  }
}

function browserNotificationPermission(): NotificationPermission | "unsupported" {
  return typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported";
}

function DismissiblePrompt({ active, className, children }: { active: boolean; className: string; children: React.ReactNode }) {
  const [visible, setVisible] = useState(active);
  const [offsetX, setOffsetX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef<number | null>(null);
  const dismiss = () => {
    setVisible(false);
    setOffsetX(0);
    setDragging(false);
    startX.current = null;
  };
  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const timeout = window.setTimeout(dismiss, 5_000);
    return () => window.clearTimeout(timeout);
  }, [active]);
  if (!active || !visible) return null;
  return <aside role="status" className={`${className} touch-pan-y select-none`} style={{ transform: `translateX(${offsetX}px)`, opacity: Math.max(0.25, 1 - Math.abs(offsetX) / 260), transition: dragging ? "none" : "transform 180ms cubic-bezier(0.23, 1, 0.32, 1), opacity 180ms cubic-bezier(0.23, 1, 0.32, 1)" }} onPointerDown={event => { if (event.pointerType === "mouse" && event.button !== 0) return; startX.current = event.clientX; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (startX.current === null) return; const distance = event.clientX - startX.current; if (Math.abs(distance) > 6) setDragging(true); setOffsetX(distance); }} onPointerUp={() => { if (Math.abs(offsetX) >= 72) dismiss(); else { setOffsetX(0); setDragging(false); startX.current = null; } }} onPointerCancel={() => { setOffsetX(0); setDragging(false); startX.current = null; }}>{children}<IconButton label="Fechar aviso" onClick={dismiss} className="h-8 w-8 shrink-0"><X size={17} /></IconButton></aside>;
}

function NotificationPermissionPrompt({ permission, onEnable }: { permission: NotificationPermission | "unsupported"; onEnable: () => void }) {
  return <DismissiblePrompt active={permission === "default"} className="fixed bottom-4 left-4 right-4 z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-violet-400/25 bg-[#20243a]/95 p-3 shadow-2xl backdrop-blur sm:left-auto sm:right-5"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-500/20 text-violet-200"><Bell size={19} /></span><div className="min-w-0 flex-1"><p className="text-xs font-bold text-white">Ative as notificações</p><p className="mt-0.5 text-[11px] leading-4 text-slate-400">Receba avisos de novas mensagens mesmo quando estiver em outra aba.</p></div><Button onClick={onEnable} className="h-9 shrink-0 rounded-xl bg-violet-500 px-3 text-xs hover:bg-violet-400">Ativar</Button></DismissiblePrompt>;
}

function InstallAppPrompt({ available, platform, mobileReleaseUrl, iosInstallUrl, onInstall, onDownload }: { available: boolean; platform: MobileInstallPlatform | null; mobileReleaseUrl: string | null; iosInstallUrl: string | null; onInstall: () => void; onDownload: () => void }) {
  const isAndroid = platform === "android" && Boolean(mobileReleaseUrl);
  const isIos = platform === "ios";
  const title = isAndroid ? "Baixe o app Android" : isIos ? (iosInstallUrl ? "Instale o app no iPhone" : "Instale no iPhone") : "Instale o Resenha Chat";
  const description = isAndroid ? "Baixe a versão mais recente da APK publicada." : isIos ? (iosInstallUrl ? "Abra a distribuição iPhone configurada para instalar o app." : "Use o Safari para adicionar a Resenha à Tela de Início.") : "Instale pelo navegador usando o aplicativo web.";
  const action = isAndroid ? "Baixar APK" : isIos ? (iosInstallUrl ? "Instalar" : "Como instalar") : "Instalar";
  return <DismissiblePrompt active={available || Boolean(platform)} className="fixed left-4 right-4 top-4 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-emerald-400/25 bg-[#20243a]/95 p-3 shadow-2xl backdrop-blur sm:left-auto sm:right-5"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500/20 text-emerald-200"><MonitorUp size={19} /></span><div className="min-w-0 flex-1"><p className="text-xs font-bold text-white">{title}</p><p className="mt-0.5 text-[11px] leading-4 text-slate-400">{description}</p></div><Button onClick={isAndroid || isIos ? onDownload : onInstall} className="h-9 shrink-0 rounded-xl bg-emerald-500 px-3 text-xs text-white hover:bg-emerald-400">{action}</Button></DismissiblePrompt>;
}

function IosInstallHelp({ onClose }: { onClose: () => void }) {
  return <Modal onClose={onClose}><div className="flex items-start justify-between"><div><h2 className="text-lg font-bold">Instalar no iPhone</h2><p className="mt-1 text-sm text-slate-400">A Resenha funciona como aplicativo web no iOS.</p></div><IconButton label="Fechar" onClick={onClose}><X size={18} /></IconButton></div><ol className="mt-5 space-y-3 text-sm leading-6 text-slate-300"><li><strong className="text-white">1.</strong> Abra este site no <strong className="text-white">Safari</strong>.</li><li><strong className="text-white">2.</strong> Toque em <strong className="text-white">Compartilhar</strong> na barra do Safari.</li><li><strong className="text-white">3.</strong> Escolha <strong className="text-white">Adicionar à Tela de Início</strong> e confirme.</li></ol><p className="mt-5 rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-xs leading-5 text-amber-100">Uma IPA não pode ser instalada diretamente por download comum: ela precisa de assinatura Apple e distribuição por TestFlight, App Store ou um fluxo corporativo/ad hoc autorizado.</p><Button onClick={onClose} className="mt-5 h-10 w-full rounded-xl bg-emerald-500 hover:bg-emerald-400">Entendi</Button></Modal>;
}

function MobileGroupRail({ groups, selectedGroupId, onMessages, onSelectGroup, onCreateGroup, onSettings }: { groups: LocalGroup[]; selectedGroupId: string | null; onMessages: () => void; onSelectGroup: (group: LocalGroup) => void; onCreateGroup: () => void; onSettings: () => void }) {
	  return <nav aria-label="Grupos e configurações" className="mobile-group-rail fixed inset-x-0 bottom-0 z-30 flex h-[calc(60px+env(safe-area-inset-bottom))] items-center gap-2 overflow-x-auto border-t border-white/[.08] bg-[#10121a]/95 px-3 pb-[env(safe-area-inset-bottom)] pt-2 shadow-[0_-12px_28px_rgba(0,0,0,.28)] backdrop-blur md:hidden"><button type="button" onClick={onMessages} className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl transition ${!selectedGroupId ? "bg-violet-500 text-white" : "bg-[#1b1f2c] text-slate-300"}`} aria-label="Abrir mensagens"><Users size={18} /></button>{groups.map(group => <button type="button" key={group.id} onClick={() => onSelectGroup(group)} className={`grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl text-xs font-black transition ${selectedGroupId === group.id ? "bg-violet-500 text-white ring-2 ring-violet-300/70" : "bg-[#1b1f2c] text-slate-200"}`} aria-label={`Abrir grupo ${group.name}`} title={group.name}>{group.imageUrl ? <img src={group.imageUrl} alt="" className="h-full w-full object-cover" /> : initials(group.name)}</button>)}<button type="button" onClick={onCreateGroup} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#1b1f2c] text-emerald-300 transition hover:bg-emerald-500 hover:text-white" aria-label="Criar grupo"><Plus size={19} /></button><button type="button" onClick={onSettings} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#1b1f2c] text-slate-300 transition hover:bg-violet-500 hover:text-white" aria-label="Abrir configurações do perfil"><Settings size={18} /></button></nav>;
}

function ServerMemberTray({ group, onInvite, onOpenMembers, onViewProfile }: { group: LocalGroup; onInvite: () => void; onOpenMembers: () => void; onViewProfile: (profile: LocalProfile) => void }) {
  const [expanded, setExpanded] = useState(false);
  const dragStartY = useRef<number | null>(null);
  const visibleMembers = group.members.slice(0, 5);
  const openFromDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartY.current !== null && event.clientY - dragStartY.current > 22) setExpanded(true);
    dragStartY.current = null;
  };

  return <div className="border-b border-white/[.06] bg-[#141724]/70 px-3 pb-2 pt-1">
    <div className="mx-auto mb-1 h-3 w-14 touch-none py-1" onPointerDown={event => { dragStartY.current = event.clientY; }} onPointerUp={openFromDrag} onPointerCancel={() => { dragStartY.current = null; }} aria-label="Arraste para abrir membros"><div className="mx-auto h-1 w-9 rounded-full bg-white/15" /></div>
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => setExpanded(value => !value)} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-1.5 text-left transition hover:bg-white/[.05]" aria-expanded={expanded} aria-label="Abrir membros do servidor">
        <span className="min-w-0"><span className="block text-[10px] font-black uppercase tracking-[.14em] text-slate-500">Membros</span><span className="block text-xs font-semibold text-slate-200">{group.members.length} {group.members.length === 1 ? "pessoa" : "pessoas"}</span></span>
        <span className="ml-auto flex -space-x-2">{visibleMembers.map(member => <span key={member.id} className="inline-flex rounded-full border-2 border-[#171a25]"><ProfileAvatar profile={member} className="h-7 w-7" /></span>)}</span>
        <span className="text-sm font-bold text-slate-400">{expanded ? "−" : "+"}</span>
      </button>
      <button type="button" onClick={onInvite} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-[#78b43d] px-3 text-xs font-black text-white shadow-lg shadow-emerald-950/25 transition hover:bg-[#8ac94b]" aria-label="Convidar novos membros"><UserPlus size={16} />Convidar</button>
    </div>
    {expanded && <div className="mt-2 rounded-2xl border border-white/[.08] bg-[#10121a] p-2 shadow-xl shadow-black/20"><div className="mb-1 flex items-center justify-between px-1"><span className="text-[11px] font-black uppercase tracking-[.13em] text-slate-400">Membros do servidor</span><button type="button" onClick={() => setExpanded(false)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-white/[.08] hover:text-white" aria-label="Fechar painel de membros"><X size={17} /></button></div><div className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto pr-1">{group.members.map(member => <button type="button" key={member.id} onClick={() => onViewProfile(member)} className="flex min-w-0 items-center gap-2 rounded-xl p-2 text-left transition hover:bg-white/[.06]"><ProfileAvatar profile={member} className="h-7 w-7" /><span className="min-w-0 truncate text-xs font-semibold text-slate-200">{group.memberProfiles?.[member.id]?.displayName || member.displayName}</span></button>)}</div><div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={() => { setExpanded(false); onOpenMembers(); }} className="h-9 rounded-xl border border-white/[.1] bg-white/[.04] text-xs font-bold text-slate-200 transition hover:bg-white/[.08]">Ver todos</button><button type="button" onClick={() => { setExpanded(false); onInvite(); }} className="h-9 rounded-xl bg-violet-500 text-xs font-bold text-white transition hover:bg-violet-400">Adicionar pessoas</button></div></div>}
  </div>;
}

export default function Home() {
  const [store, setStore] = useState<OrbitStore>(() => readOrbitStore());
  const [socket, setSocket] = useState<Socket | null>(null);
  const [activeRoom, setActiveRoom] = useState<ActiveRoom | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [compose, setCompose] = useState("");
  const [attachment, setAttachment] = useState<LocalAttachment | null>(null);
  const [replyingTo, setReplyingTo] = useState<LocalMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<LocalMessage | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [showGroup, setShowGroup] = useState(false);
  const [showGroupEdit, setShowGroupEdit] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showChannel, setShowChannel] = useState(false);
  const [showChannelManager, setShowChannelManager] = useState(false);
  const [viewedProfile, setViewedProfile] = useState<LocalProfile | null>(null);
  const [managedMember, setManagedMember] = useState<LocalProfile | null>(null);
  const [voiceChannelTitle, setVoiceChannelTitle] = useState<string | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">(() => browserNotificationPermission());
	  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
	  const [isInstalled, setIsInstalled] = useState(false);
		  const [mobilePlatform, setMobilePlatform] = useState<MobileInstallPlatform | null>(null);
		  const [mobileReleaseUrl, setMobileReleaseUrl] = useState<string | null>(null);
		  const [iosReleaseUrl, setIosReleaseUrl] = useState<string | null>(null);
		  const [showIosInstallHelp, setShowIosInstallHelp] = useState(false);
  const [liveVoiceRooms, setLiveVoiceRooms] = useState<Record<string, boolean>>({});
  const [voiceParticipants, setVoiceParticipants] = useState<Record<string, LocalProfile[]>>({});
  const [observedCalls, setObservedCalls] = useState<Record<string, ObservedCall>>({});
	  const [onlineContactIds, setOnlineContactIds] = useState<Set<string>>(() => new Set());
	  const [awayContactIds, setAwayContactIds] = useState<Set<string>>(() => new Set());
	  const [isAway, setIsAway] = useState(false);
	  const [showRequests, setShowRequests] = useState(false);
	  const [showAccounts, setShowAccounts] = useState(false);
	  const [addingAccount, setAddingAccount] = useState(false);
	  const [switchingAccount, setSwitchingAccount] = useState<LocalAccountRecord | null>(null);
	  const [accountVault, setAccountVault] = useState<LocalAccountRecord[]>(() => readAccountVault());
	  const [upgradingGuest, setUpgradingGuest] = useState(false);
	  const [unreadRooms, setUnreadRooms] = useState<Record<string, { count: number; mentions: number }>>(() => store.unreadRooms || {});
  const profileRef = useRef<LocalProfile | null>(store.profile);
	  const activeRoomRef = useRef<ActiveRoom | null>(activeRoom);
  const contactIdsRef = useRef<string[]>(store.contacts.map(contact => contact.id));
  const syncContactPresenceRef = useRef<(() => void) | null>(null);
  const syncVoiceWatchRef = useRef<(() => void) | null>(null);
	  const syncCallWatchRef = useRef<(() => void) | null>(null);
	  const refreshingOfficialSessionRef = useRef<string | null>(null);
  const call = useCall(socket);
  const profile = store.profile;
  const selectedGroup = useMemo(() => store.groups.find(group => group.id === selectedGroupId) || null, [selectedGroupId, store.groups]);
  const activeMessages = activeRoom ? store.messages[activeRoom.id] || [] : [];
  const activeCallRoom = activeRoom ? `${activeRoom.kind}:${activeRoom.id}` : null;
  const observedCall = activeCallRoom ? observedCalls[activeCallRoom] || null : null;
	  const unreadTotal = Object.values(unreadRooms).reduce((total, item) => total + item.count, 0);
	  const mentionTotal = Object.values(unreadRooms).reduce((total, item) => total + item.mentions, 0);

	  useEffect(() => {
	    const result = writeOrbitStore(store);
	    if (store.profile) setAccountVault(saveAccountSnapshot(store));
	    if (!result.saved) {
	      return;
	    }
	    // Quando a cópia persistida precisa ser compactada, a mensagem enviada
	    // continua disponível nesta sessão. Não atualize `store` a partir dessa
	    // cópia: isso faria o efeito salvar de novo e poderia causar o ciclo
	    // "Maximum update depth exceeded".
	  }, [store]);

	  useEffect(() => {
	    setStore(current => {
	      const previous = current.unreadRooms || {};
	      if (JSON.stringify(previous) === JSON.stringify(unreadRooms)) return current;
	      return { ...current, unreadRooms };
	    });
	  }, [unreadRooms]);

		  useEffect(() => {
		    const isAndroidBrowser = /Android/i.test(navigator.userAgent) && !isNativeRuntime();
		    const isIosBrowser = /iPhone|iPad|iPod/i.test(navigator.userAgent) && !isNativeRuntime();
		    const isMobileBrowser = isAndroidBrowser || isIosBrowser;
		    const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
		    setIsInstalled(standalone);
		    setMobilePlatform(isAndroidBrowser ? "android" : isIosBrowser ? "ios" : null);
		    if (isMobileBrowser && !standalone && navigator.onLine) void getLatestPlatformReleaseDownloads().then(downloads => {
		      setMobileReleaseUrl(downloads?.android.url || "https://github.com/Igu2012/ResenhaChat/releases/latest");
		      setIosReleaseUrl(import.meta.env.VITE_IOS_INSTALL_URL?.trim() || downloads?.ios.url || null);
		    });
	    const onBeforeInstall = (event: Event) => { if (isMobileBrowser) return; event.preventDefault(); setInstallPrompt(event as InstallPromptEvent); };
	    const onInstalled = () => { setInstallPrompt(null); setIsInstalled(true); toast.success("Resenha Chat instalado neste dispositivo."); };
	    window.addEventListener("beforeinstallprompt", onBeforeInstall);
	    window.addEventListener("appinstalled", onInstalled);
	    return () => { window.removeEventListener("beforeinstallprompt", onBeforeInstall); window.removeEventListener("appinstalled", onInstalled); };
	  }, []);

	  useEffect(() => {
	    const viewport = window.visualViewport;
	    if (!viewport) return;
	    const syncViewportHeight = () => document.documentElement.style.setProperty("--resenha-vvh", `${viewport.height}px`);
	    syncViewportHeight();
	    viewport.addEventListener("resize", syncViewportHeight);
	    viewport.addEventListener("scroll", syncViewportHeight);
	    return () => { viewport.removeEventListener("resize", syncViewportHeight); viewport.removeEventListener("scroll", syncViewportHeight); document.documentElement.style.removeProperty("--resenha-vvh"); };
	  }, []);

	  useEffect(() => { profileRef.current = profile; }, [profile]);
	  useEffect(() => {
	    activeRoomRef.current = activeRoom;
	    if (!activeRoom) return;
	    setUnreadRooms(current => {
	      const { [activeRoom.id]: _read, ...rest } = current;
	      return rest;
	    });
	  }, [activeRoom]);

	  useEffect(() => {
	    let removeListener: (() => void) | undefined;
	    void addNativeBackButtonListener(() => {
	      if (activeRoomRef.current) {
	        setActiveRoom(null);
	        setSelectedGroupId(null);
	        setSidebarOpen(true);
	        return;
	      }
	      if (sidebarOpen) {
	        setSidebarOpen(false);
	        return;
	      }
	      void exitNativeApp();
	    }).then(remove => { removeListener = remove; });
	    return () => { removeListener?.(); };
	  }, [sidebarOpen]);

	  useEffect(() => {
    let cancelled = false;
    void checkForUpdate().then(update => {
      if (cancelled || !update?.url) return;
      if (!shouldOpenUpdateDownload(update.version || "latest")) return;
      markUpdateDownloadOffered(update.version || "latest");
      toast.info(`Atualização ${update.version} disponível. Abrindo o download…`);
      void openUpdateDownload(update.url);
    });
    return () => { cancelled = true; };
  }, []);

	  useEffect(() => {
	    if (!profile || profile.encryptionPublicKey) return;
	    let cancelled = false;
	    void ensureEncryptionPublicKey(profile.id).then(encryptionPublicKey => {
	      if (cancelled) return;
	      setStore(current => current.profile?.id === profile.id && !current.profile.encryptionPublicKey
	        ? { ...current, profile: { ...current.profile, encryptionPublicKey } }
	        : current);
	    }).catch(() => toast.error("Não foi possível preparar este dispositivo para conversar."));
	    return () => { cancelled = true; };
	  }, [profile?.encryptionPublicKey, profile?.id]);

	  useEffect(() => {
	    if (!profile || profile.accountType !== "official") return;
	    const refreshToken = readOfficialRefreshToken(profile.id);
	    if (!refreshToken) return;
	    let cancelled = false;
	    const refreshSession = async () => {
	      if (refreshingOfficialSessionRef.current === profile.id) return;
	      refreshingOfficialSessionRef.current = profile.id;
	      try {
	        const account = await refreshOfficialAccount(runtimeApiUrl("/api/account/refresh"), refreshToken);
	        if (!cancelled) setStore(current => current.profile?.id === profile.id ? applyOfficialSession(current, account) : current);
	      } catch {
	        // A conta local permanece aberta e tenta renovar novamente ao recuperar a internet.
	      } finally {
	        if (refreshingOfficialSessionRef.current === profile.id) refreshingOfficialSessionRef.current = null;
	      }
	    };
	    if (!profile.authToken) void refreshSession();
	    const timer = window.setInterval(() => { void refreshSession(); }, 50 * 60 * 1000);
	    window.addEventListener("online", refreshSession);
	    return () => {
	      cancelled = true;
	      window.clearInterval(timer);
	      window.removeEventListener("online", refreshSession);
	    };
	  }, [profile?.accountType, profile?.authToken, profile?.id]);

	  useEffect(() => {
    contactIdsRef.current = store.contacts.map(contact => contact.id);
    syncContactPresenceRef.current?.();
  }, [store.contacts]);

  useEffect(() => {
    if (!profile) return;
	    const instance = io(getRuntimeServerOrigin(), { path: "/api/socket.io", auth: { profile }, transports: ["polling", "websocket"], upgrade: true, reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 700, reconnectionDelayMax: 5000, randomizationFactor: 0.35, timeout: 30_000 });
    // O registro de push nativo não é iniciado automaticamente ao criar um perfil.
    // Isso evita encerrar a APK quando serviços Google ainda não estiverem disponíveis no aparelho.
    const syncContactPresence = () => {
      if (!instance.connected) return;
      instance.emit("presence:watch", { contactIds: contactIdsRef.current }, (result: { onlineIds?: string[]; awayIds?: string[] }) => {
        setOnlineContactIds(new Set(Array.isArray(result?.onlineIds) ? result.onlineIds : []));
        setAwayContactIds(new Set(Array.isArray(result?.awayIds) ? result.awayIds : []));
      });
    };
    syncContactPresenceRef.current = syncContactPresence;
    let activityTimer: number | undefined;
    let lastActivitySentAt = 0;
    const noteActivity = (force = false) => {
      setIsAway(false);
      if (activityTimer) window.clearTimeout(activityTimer);
      activityTimer = window.setTimeout(() => setIsAway(true), 5 * 60 * 1000);
      const now = Date.now();
      if (instance.connected && (force || now - lastActivitySentAt >= 30_000)) {
        lastActivitySentAt = now;
        instance.emit("presence:activity");
      }
    };
    const refreshPresence = () => {
      const latestProfile = profileRef.current;
      if (!latestProfile) return;
      instance.auth = { profile: latestProfile };
      if (instance.connected) {
        instance.emit("profile:refresh", latestProfile);
        instance.emit("pending:pull");
        syncContactPresence();
        syncVoiceWatchRef.current?.();
        syncCallWatchRef.current?.();
      } else {
        instance.connect();
      }
    };
    const recoverAfterResume = () => {
      if (document.visibilityState === "visible") {
        noteActivity(true);
        refreshPresence();
      }
    };
    const noteInteraction = () => noteActivity();
    const retryAfterExhaustion = () => window.setTimeout(() => instance.connect(), 1200);
    setSocket(instance);
    instance.on("connect", () => { noteActivity(true); refreshPresence(); });
    instance.on("disconnect", reason => {
      if (reason === "io server disconnect") instance.connect();
    });
    instance.io.on("reconnect_failed", retryAfterExhaustion);
    instance.on("contact:added", (contact: LocalProfile) => {
      setStore(current => ({ ...current, contacts: upsertContact(current.contacts, contact) }));
      toast.success(`${contact.displayName} adicionou você aos contatos.`);
    });
    const receiveRequest = (request: LocalRequest) => {
      if (!request?.id || !request.from) return;
      setStore(current => current.requests.some(item => item.id === request.id) ? current : { ...current, requests: [...current.requests, request] });
      setShowRequests(true);
      const text = request.kind === "contact" ? `${request.from.displayName} quer adicionar você.` : `${request.from.displayName} enviou um convite de grupo.`;
      toast.info(text);
      notifyBackgroundActivity(request.kind === "contact" ? "Nova solicitação de contato" : "Novo convite de grupo", text, `resenha-request-${request.id}`);
    };
    instance.on("contact:request", ({ request }: { request: LocalRequest }) => receiveRequest(request));
    instance.on("group:request", ({ request }: { request: LocalRequest }) => receiveRequest(request));
    instance.on("contact:presence", ({ profileId, online, status }: { profileId: string; online: boolean; status?: "online" | "away" }) => {
      if (typeof profileId !== "string" || typeof online !== "boolean") return;
      setOnlineContactIds(current => {
        const next = new Set(current);
        if (online) next.add(profileId);
        else next.delete(profileId);
        return next;
      });
      setAwayContactIds(current => {
        const next = new Set(current);
        if (online && status === "away") next.add(profileId);
        else next.delete(profileId);
        return next;
      });
    });
	    instance.on("profile:updated", ({ profile: updated }: { profile: LocalProfile }) => {
	      if (!updated?.id) return;
	      setStore(current => replaceProfileEverywhere(current, updated));
	      setActiveRoom(current => current?.partner?.id === updated.id ? { ...current, partner: { ...current.partner, ...updated } } : current);
	      setViewedProfile(current => current?.id === updated.id ? { ...current, ...updated } : current);
	    });
	    const receiveMessage = async (sender: LocalProfile, message: LocalMessage) => {
	      let readable = message;
	      if (isEncryptedMessage(message.encrypted)) {
	        try {
	          const content = await decryptMessageForRecipient(profileRef.current?.id || "", sender.encryptionPublicKey, message.encrypted);
          readable = { ...message, body: content.body, attachment: content.attachment, replyTo: content.replyTo };
	        } catch {
	          toast.error(`Não foi possível abrir a mensagem de ${sender.displayName} neste dispositivo.`);
	          return;
	        }
	      }
	      const username = profileRef.current?.username?.toLowerCase();
	      const mention = Boolean(readable.body && (/\B@everyone\b/i.test(readable.body) || (username && new RegExp(`\\B@${username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(readable.body))));
	      if (activeRoomRef.current?.id !== readable.roomId) setUnreadRooms(current => {
	        const previous = current[readable.roomId] || { count: 0, mentions: 0 };
	        return { ...current, [readable.roomId]: { count: previous.count + 1, mentions: previous.mentions + (mention ? 1 : 0) } };
	      });
	      setStore(current => ({ ...current, contacts: upsertContact(current.contacts, sender), messages: appendMessage(current.messages, readable) }));
	      notifyIncomingMessage(sender, readable);
	    };
	    instance.on("direct:message", ({ sender, message }: { sender: LocalProfile; message: LocalMessage }) => { void receiveMessage(sender, message); });
	    instance.on("group:invite-message", ({ sender, request }: { sender: LocalProfile; request: LocalRequest }) => {
	      if (!request?.group || !profileRef.current) return;
	      const roomId = directRoomId(profileRef.current.id, sender.id);
	      const inviteMessage: LocalMessage = { id: `invite:${request.id}`, roomId, author: sender, body: null, attachment: null, createdAt: request.createdAt, groupInvite: request };
	      if (activeRoomRef.current?.id !== roomId) setUnreadRooms(current => ({ ...current, [roomId]: { count: (current[roomId]?.count || 0) + 1, mentions: current[roomId]?.mentions || 0 } }));
	      setStore(current => ({ ...current, contacts: upsertContact(current.contacts, sender), messages: appendMessage(current.messages, inviteMessage) }));
	      toast.info(`${sender.displayName} enviou um convite de grupo na conversa.`);
	    });
    instance.on("group:invited", ({ group }: { group: LocalGroup }) => {
      setStore(current => ({ ...current, groups: current.groups.some(item => item.id === group.id) ? current.groups.map(item => item.id === group.id ? group : item) : [...current.groups, group] }));
      toast.success(`Você entrou no grupo ${group.name}.`);
    });
    instance.on("group:updated", ({ group }: { group: LocalGroup }) => {
      setStore(current => ({ ...current, groups: current.groups.map(item => item.id === group.id ? group : item) }));
    });
    instance.on("group:role-updated", ({ groupId, memberId, role }: { groupId: string; memberId: string; role: "admin" | "member" }) => {
      setStore(current => ({ ...current, groups: current.groups.map(group => group.id !== groupId ? group : { ...group, admins: role === "admin" ? Array.from(new Set([...(group.admins || []), memberId])) : (group.admins || []).filter(id => id !== memberId), memberProfiles: { ...(group.memberProfiles || {}), [memberId]: { ...(group.memberProfiles?.[memberId] || {}), role } } }) }));
    });
    instance.on("group:member-profile-updated", ({ groupId, memberId, displayName, tag, tagColor }: { groupId: string; memberId: string; displayName: string; tag: string; tagColor: string }) => {
      setStore(current => ({ ...current, groups: current.groups.map(group => group.id !== groupId ? group : { ...group, memberProfiles: { ...(group.memberProfiles || {}), [memberId]: { ...(group.memberProfiles?.[memberId] || {}), displayName, tag, tagColor } } }) }));
    });
	    instance.on("message:react", ({ messageId, roomId, emoji, profileId, action }: { messageId: string; roomId: string; emoji: string; profileId: string; action: "add" | "remove" }) => {
	      setStore(current => ({ ...current, messages: updateMessage(current.messages, roomId, messageId, message => {
	        const people = message.reactions?.[emoji] || [];
	        const nextPeople = action === "remove" ? people.filter(id => id !== profileId) : (people.includes(profileId) ? people : [...people, profileId]);
	        return { ...message, reactions: { ...(message.reactions || {}), [emoji]: nextPeople } };
	      }) }));
	    });
	    instance.on("message:deleted", ({ messageId, roomId, deletedBy, deletedAt }: { messageId: string; roomId: string; deletedBy: string; deletedAt: string }) => {
      setStore(current => ({ ...current, messages: updateMessage(current.messages, roomId, messageId, message => ({ ...message, body: null, attachment: null, encrypted: undefined, reactions: {}, deletedBy, deletedAt })) }));
	    });
	    instance.on("message:edited", ({ messageId, roomId, message, editedAt }: { messageId: string; roomId: string; message: LocalMessage; editedAt: string }) => {
	      void (async () => {
	        const sender = message?.author;
	        if (!sender?.id) return;
	        let readable = message;
	        if (isEncryptedMessage(message.encrypted)) {
	          try {
	            const content = await decryptMessageForRecipient(profileRef.current?.id || "", sender.encryptionPublicKey, message.encrypted);
	            readable = { ...message, body: content.body, attachment: content.attachment, replyTo: content.replyTo };
	          } catch {
	            toast.error("Não foi possível abrir a edição desta mensagem.");
	            return;
	          }
	        }
	        setStore(current => ({ ...current, contacts: upsertContact(current.contacts, sender), messages: updateMessage(current.messages, roomId, messageId, existing => ({ ...existing, author: sender, body: readable.body, attachment: readable.attachment, encrypted: readable.encrypted, replyTo: readable.replyTo, editedAt })) }));
	      })();
	    });
	    instance.on("group:member-removed", ({ groupId, memberId, messageIds, removedBy }: { groupId: string; memberId: string; messageIds: string[]; removedBy: string }) => {
	      setStore(current => {
	        const groups = current.groups.filter(group => !(group.id === groupId && memberId === current.profile?.id)).map(group => group.id === groupId ? { ...group, members: group.members.filter(member => member.id !== memberId), admins: (group.admins || []).filter(id => id !== memberId) } : group);
	        const messages = Object.fromEntries(Object.entries(current.messages).map(([roomId, items]) => [roomId, items.map(message => messageIds?.includes(message.id) ? { ...message, body: null, attachment: null, encrypted: undefined, deletedBy: removedBy, deletedAt: new Date().toISOString() } : message)]));
	        return { ...current, groups, messages };
	      });
	    });
	    instance.on("group:message", ({ sender, message }: { sender: LocalProfile; message: LocalMessage }) => { void receiveMessage(sender, message); });
    instance.on("offline:recovered", ({ count }: { count: number }) => toast.success(`${count} mensagem(ns) recebida(s) enquanto você estava offline.`));
    instance.on("call:group-live", ({ room, sharingScreen }: { room: string; sharingScreen: boolean }) => {
      if (typeof room === "string" && typeof sharingScreen === "boolean") setLiveVoiceRooms(current => ({ ...current, [room]: sharingScreen }));
    });
    instance.on("voice:presence", ({ room, participants }: { room: string; participants: LocalProfile[] }) => {
      if (typeof room === "string" && Array.isArray(participants)) setVoiceParticipants(current => ({ ...current, [room]: participants }));
    });
    instance.on("call:presence", (presence: ObservedCall) => {
      if (typeof presence?.room !== "string" || !Array.isArray(presence.participants)) return;
      setObservedCalls(current => ({ ...current, [presence.room]: presence }));
    });
    window.addEventListener("online", refreshPresence);
    window.addEventListener("focus", recoverAfterResume);
    document.addEventListener("visibilitychange", recoverAfterResume);
    window.addEventListener("pointerdown", noteInteraction);
    window.addEventListener("keydown", noteInteraction);
    window.addEventListener("touchstart", noteInteraction);
    noteActivity(true);
    return () => {
      window.removeEventListener("online", refreshPresence);
      window.removeEventListener("focus", recoverAfterResume);
      document.removeEventListener("visibilitychange", recoverAfterResume);
      window.removeEventListener("pointerdown", noteInteraction);
      window.removeEventListener("keydown", noteInteraction);
      window.removeEventListener("touchstart", noteInteraction);
      if (activityTimer) window.clearTimeout(activityTimer);
      instance.io.off("reconnect_failed", retryAfterExhaustion);
      if (syncContactPresenceRef.current === syncContactPresence) syncContactPresenceRef.current = null;
      instance.disconnect();
      setSocket(null);
    };
  }, [profile?.id, profile?.authToken]);

	  useEffect(() => {
	    if (!socket || !profile) return;
	    socket.auth = { profile };
	    if (socket.connected) socket.emit("profile:refresh", profile);
	  }, [profile, socket]);

	  useEffect(() => {
	    if (!socket || !isNativeRuntime()) return;
	    let dispose: () => void = () => {};
	    void registerNativePush(socket).then(cleanup => { dispose = cleanup; });
	    return () => { dispose(); };
	  }, [socket]);

	  useEffect(() => {
	    if (!isNativeRuntime() || !profile?.id) return;
	    void subscribeNativePushProfile(profile.id);
	  }, [profile?.id]);

  useEffect(() => {
    if (!socket || !selectedGroup) {
      syncVoiceWatchRef.current = null;
      return;
    }
    const rooms = selectedGroup.channels.filter(channel => channel.kind === "voice").map(channel => voiceRoomId(selectedGroup.id, channel.id));
    const syncVoiceWatch = () => {
      if (!socket.connected) return;
      socket.emit("call:live-status", { rooms }, (result: { states?: Record<string, boolean> }) => {
        if (result?.states) setLiveVoiceRooms(current => ({ ...current, ...result.states }));
      });
      socket.emit("voice:watch", { rooms }, (result: { participants?: Record<string, LocalProfile[]> }) => {
        if (result?.participants) setVoiceParticipants(current => ({ ...current, ...result.participants }));
      });
    };
    syncVoiceWatchRef.current = syncVoiceWatch;
    syncVoiceWatch();
    return () => {
      if (syncVoiceWatchRef.current === syncVoiceWatch) syncVoiceWatchRef.current = null;
    };
  }, [selectedGroup, socket]);

  useEffect(() => {
    if (!socket || !activeCallRoom) {
      syncCallWatchRef.current = null;
      return;
    }
    const syncCallWatch = () => {
      if (!socket.connected) return;
      socket.emit("call:watch", { rooms: [activeCallRoom] }, (result: { calls?: Record<string, ObservedCall> }) => {
        if (result?.calls) setObservedCalls(current => ({ ...current, ...result.calls }));
      });
    };
    syncCallWatchRef.current = syncCallWatch;
    syncCallWatch();
    return () => {
      if (syncCallWatchRef.current === syncCallWatch) syncCallWatchRef.current = null;
    };
  }, [activeCallRoom, socket]);

  useEffect(() => {
    if (call.error) toast.error(call.error);
  }, [call.error]);

  useEffect(() => {
    const invite = call.incomingCall;
    if (!invite) return;
    notifyBackgroundActivity(`${invite.caller.displayName} está ligando`, invite.withVideo ? "Chamada de vídeo recebida." : "Chamada de áudio recebida.", `resenha-call-${invite.room}`);
  }, [call.incomingCall?.room]);

  useEffect(() => {
    if (!call.room) setVoiceChannelTitle(null);
  }, [call.room]);

  useEffect(() => {
    const restoreTitle = () => { if (document.visibilityState === "visible") document.title = APP_NAME; };
    document.addEventListener("visibilitychange", restoreTitle);
    return () => document.removeEventListener("visibilitychange", restoreTitle);
  }, []);

  useEffect(() => {
    const refreshPermission = () => setNotificationPermission(browserNotificationPermission());
    refreshPermission();
    window.addEventListener("focus", refreshPermission);
    document.addEventListener("visibilitychange", refreshPermission);
    return () => {
      window.removeEventListener("focus", refreshPermission);
      document.removeEventListener("visibilitychange", refreshPermission);
    };
  }, []);

  useEffect(() => {
    if (!isNativeRuntime()) return;
    let cancelled = false;
    void requestNativeNotificationPermission().then(granted => {
      if (!cancelled && granted) setNotificationPermission("granted");
    });
    return () => { cancelled = true; };
  }, []);

  const updateStore = (updater: (current: OrbitStore) => OrbitStore) => setStore(updater);

  const requestBrowserNotifications = async () => {
    if (isNativeRuntime()) {
      const granted = await requestNativeNotificationPermission();
      setNotificationPermission(granted ? "granted" : "denied");
      if (granted) toast.success("Notificações do aplicativo ativadas.");
      else toast.error("Permita as notificações nas configurações do Android para receber avisos.");
      return;
    }
    if (!("Notification" in window)) return toast.error("Este navegador não oferece notificações nativas.");
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission === "granted") toast.success("Notificações do navegador ativadas.");
    else toast.error("Permita as notificações nas opções do navegador para receber avisos.");
  };

  const requestAppInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

	  const createProfile = async (event: React.FormEvent<HTMLFormElement>) => {
	    event.preventDefault();
	    const data = new FormData(event.currentTarget);
	    const mode = String(data.get("mode") || "guest");
	    if (upgradingGuest && mode !== "official") { toast.error("Escolha uma conta oficial para concluir a migração."); return; }
	    const username = String(data.get("username") || "").trim();
	    const password = String(data.get("password") || "");
	    const passwordConfirmation = String(data.get("passwordConfirmation") || "");
	    let account: OfficialLogin | null = null;
	    if (mode === "official") {
	      if (!username || !password) { toast.error("Preencha nome de usuário e senha."); return; }
	      if (data.get("intent") === "register" && !passwordsMatch(password, passwordConfirmation)) { toast.error("As duas senhas precisam ser iguais."); return; }
	      if (!isValidUsername(username)) { toast.error(usernameRuleMessage); return; }
	      if (!isValidPassword(password)) { toast.error(passwordRuleMessage); return; }
	      try {
	        account = data.get("intent") === "login"
	          ? await loginOfficialAccount(runtimeApiUrl("/api/account/login"), username, password)
	          : await registerOfficialAccount(runtimeApiUrl("/api/account/register"), username, password, String(data.get("name") || "").trim());
	      } catch (error) {
	        toast.error(error instanceof Error ? error.message : "Não foi possível concluir a autenticação.");
	        return;
	      }
	    }
    const displayName = String(data.get("name") || account?.displayName || username || "").trim();
    if (displayName.length < 2) { toast.error("Escolha um nome com pelo menos 2 caracteres."); return; }
    const avatarFile = data.get("avatar");
    let avatarUrl: string | null = null;
    try {
      if (avatarFile instanceof File && avatarFile.size > 0) avatarUrl = (await fileAsAttachment(avatarFile)).dataUrl;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Imagem inválida.");
      return;
    }
	    const id = account?.uid || createId();
	    let encryptionPublicKey: JsonWebKey;
	    try {
	      encryptionPublicKey = await ensureEncryptionPublicKey(id);
	    } catch {
	      toast.error("Não foi possível preparar este dispositivo para conversar.");
	      return;
	    }
	    if (account?.refreshToken) saveOfficialRefreshToken(account.uid, account.refreshToken);
	    const next: LocalProfile = { id, accountUid: account?.uid, username: account?.username, authToken: account?.idToken, accountType: account ? "official" : "guest", connectionCode: createConnectionCode(), displayName, bio: String(data.get("bio") || "").trim(), avatarUrl, encryptionPublicKey };
	    const guestIdBeingMigrated = account && store.profile?.accountType === "guest" ? store.profile.id : null;
	    const rememberedAccount = account ? readAccountVault().find(record => record.id === account?.uid || record.accountUid === account?.uid || record.username === account?.username) : undefined;
	    const rememberedStore = rememberedAccount ? accountStoreForSwitch(rememberedAccount) : store;
	    const rememberedProfile = rememberedStore.profile;
	    const restoredProfile = rememberedProfile && account
	      ? { ...next, avatarUrl: next.avatarUrl || rememberedProfile.avatarUrl, bio: next.bio || rememberedProfile.bio, displayName: rememberedProfile.displayName || next.displayName, encryptionPublicKey: next.encryptionPublicKey || rememberedProfile.encryptionPublicKey }
	      : next;
	    const nextStore = rememberedStore.profile?.accountType === "guest" && account ? migrateGuestToOfficial(rememberedStore, restoredProfile) : { ...rememberedStore, profile: restoredProfile };
	    profileRef.current = restoredProfile;
	    const saved = writeOrbitStore(nextStore);
	    setStore(saved.store);
	    setAccountVault(saveAccountSnapshot(saved.store));
	    if (!account) {
	      setActiveRoom(null);
	      setSelectedGroupId(null);
	      setSidebarOpen(false);
	    }
	    if (guestIdBeingMigrated) setActiveRoom(current => current ? { ...current, id: migrateDirectRoomId(current.id, guestIdBeingMigrated, next.id) } : current);
	    if (account) setUpgradingGuest(false);
    setAddingAccount(false);
  };

	  const beginAddAccount = () => {
	    setShowAccounts(false);
	    setAddingAccount(true);
	  };

	  const switchAccount = async (record: LocalAccountRecord, password?: string) => {
	    if (record.accountType === "official") {
	      if (!record.username || !password) { setSwitchingAccount(record); return; }
	      let result: OfficialLogin;
	      try { result = await loginOfficialAccount(runtimeApiUrl("/api/account/login"), record.username, password); }
	      catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível entrar nesta conta."); return; }
	      const nextStore = accountStoreForSwitch(record);
	      setStore(applyOfficialSession(nextStore, result));
	    } else {
	      setStore(accountStoreForSwitch(record));
	    }
	    setSwitchingAccount(null);
	    setShowAccounts(false);
	    setActiveRoom(null);
    setSelectedGroupId(null);
	  };

	  const logoutCurrentAccount = () => {
	    if (profile) {
	      const saved = writeOrbitStore(store);
	      setAccountVault(saveAccountSnapshot(saved.store));
	    }
	    setStore(createEmptyOrbitStore());
	    setShowAccounts(false);
	    setActiveRoom(null);
	    setSelectedGroupId(null);
	    toast.success("Você saiu desta conta neste dispositivo.");
	  };

  const addContact = (code: string) => {
    if (!socket?.connected) return;
    socket.emit("contact:add", { code }, (result: { ok: boolean; profile?: LocalProfile; pending?: boolean; message?: string }) => {
      if (!result.ok || !result.profile) { toast.error(result.message || "Não foi possível enviar a solicitação."); return; }
      toast.success(`Solicitação enviada para ${result.profile.displayName}.`);
      setShowContact(false);
    });
  };

  const addContactByUsername = (username: string) => {
    if (!socket?.connected) return;
    socket.emit("contact:add-username", { username }, (result: { ok: boolean; profile?: LocalProfile; message?: string }) => {
      if (!result.ok || !result.profile) { toast.error(result.message || "Nome de usuário não encontrado."); return; }
      toast.success(`Solicitação enviada para ${result.profile.displayName}.`);
      setShowContact(false);
    });
  };

  const resolveRequest = (request: LocalRequest, accepted: boolean) => {
    if (!socket || !profile) return;
    socket.emit("contact:resolve", { request, accepted });
    updateStore(current => {
      if (!accepted) return { ...current, requests: current.requests.filter(item => item.id !== request.id) };
      if (request.kind === "contact") return { ...current, contacts: upsertContact(current.contacts, request.from), requests: current.requests.filter(item => item.id !== request.id) };
      if (!request.group) return { ...current, requests: current.requests.filter(item => item.id !== request.id) };
      return { ...current, groups: current.groups.some(group => group.id === request.group!.id) ? current.groups : [...current.groups, request.group!], requests: current.requests.filter(item => item.id !== request.id) };
    });
    toast.success(accepted ? "Solicitação aceita." : "Solicitação recusada.");
  };

  const openDirect = (contact: LocalProfile) => {
    setSelectedGroupId(null);
    setActiveRoom({ kind: "dm", id: directRoomId(profile!.id, contact.id), title: contact.displayName, partner: contact });
    setSidebarOpen(false);
  };

  const openGroupFromMobileRail = (group: LocalGroup) => {
    const channel = group.channels.find(item => item.kind !== "voice") || group.channels[0];
    setSelectedGroupId(group.id);
    if (channel) setActiveRoom({ kind: "channel", id: channelRoomId(group.id, channel.id), title: channel.name, groupId: group.id });
    setSidebarOpen(false);
  };

  const createGroup = (name: string, imageUrl: string | null = null) => {
    if (!profile || name.trim().length < 2) return;
    const group: LocalGroup = { id: createId(), name: name.trim(), imageUrl, ownerId: profile.id, admins: [], memberProfiles: { [profile.id]: { role: "owner", displayName: profile.displayName } }, members: [profile], channels: [{ id: createId(), name: "geral", kind: "text" }, { id: createId(), name: "Lobby", kind: "voice" }] };
    updateStore(current => ({ ...current, groups: [...current.groups, group] }));
    setSelectedGroupId(group.id);
    setActiveRoom({ kind: "channel", id: channelRoomId(group.id, group.channels[0].id), title: "geral", groupId: group.id });
    setShowGroup(false);
  };

  const inviteToGroup = async (selectedContacts: LocalProfile[], typedCode: string) => {
    if (!socket || !selectedGroup || !profile) return;
    const targets = new Map<string, LocalProfile | undefined>();
    selectedContacts.forEach(contact => targets.set(contact.connectionCode.toUpperCase(), contact));
    const manualCode = typedCode.trim().toUpperCase();
    if (manualCode) targets.set(manualCode, targets.get(manualCode));
    if (!targets.size) return toast.error("Selecione pelo menos um contato ou informe um código.");

    const group = selectedGroup;
    const results = await Promise.all(Array.from(targets.entries()).map(([code, contact]) => new Promise<{ contact?: LocalProfile; result: { ok: boolean; profile?: LocalProfile; pending?: boolean; message?: string } }>(resolve => {
      socket.emit("group:invite", { code, contact, group }, (result: { ok: boolean; profile?: LocalProfile; pending?: boolean; message?: string }) => resolve({ contact, result }));
    })));
    const delivered = results.filter(({ result }) => result.ok && result.profile);
    delivered.forEach(({ result }) => {
      const target = result.profile!;
      const request: LocalRequest = { id: `group:${profile.id}:${target.id}:${group.id}`, kind: "group", from: profile, group, createdAt: new Date().toISOString() };
      const inviteMessage: LocalMessage = { id: `invite:${request.id}`, roomId: directRoomId(profile.id, target.id), author: profile, body: null, attachment: null, createdAt: request.createdAt, groupInvite: request };
      setStore(current => ({ ...current, messages: appendMessage(current.messages, inviteMessage) }));
    });
    const failures = results.filter(({ result }) => !result.ok);
    if (delivered.length) {
      toast.success(delivered.length === 1 ? `Convite enviado para ${delivered[0].result.profile!.displayName}.` : `${delivered.length} convites enviados.`);
      setShowInvite(false);
    }
    if (failures.length) toast.error(failures[0].result.message || `${failures.length} convite(s) não puderam ser enviados.`);
  };

  const updateGroupIdentity = (name: string, imageUrl: string | null) => {
    if (!selectedGroup || !profile || selectedGroup.ownerId !== profile.id) return;
    const updated = { ...selectedGroup, name: name.trim() || selectedGroup.name, imageUrl };
    updateStore(current => ({ ...current, groups: current.groups.map(group => group.id === updated.id ? updated : group) }));
    socket?.emit("group:update", { recipientIds: updated.members.map(member => member.id), group: updated });
    setShowGroupEdit(false);
  };

  const saveServerMember = (member: LocalProfile, values: { role: "admin" | "member"; displayName: string; tag: string; tagColor: string }) => {
    if (!selectedGroup || !profile || !socket) return;
    const isOwner = selectedGroup.ownerId === profile.id;
    const isAdmin = (selectedGroup.admins || []).includes(profile.id);
    if (isOwner) socket.emit("group:role:update", { groupId: selectedGroup.id, memberId: member.id, role: values.role }, (result: { ok: boolean; message?: string }) => { if (!result.ok) toast.error(result.message || "Não foi possível alterar o papel."); });
    if (isOwner || isAdmin) socket.emit("group:member-profile:update", { groupId: selectedGroup.id, memberId: member.id, ...values }, (result: { ok: boolean; message?: string }) => { if (!result.ok) toast.error(result.message || "Não foi possível editar o perfil do servidor."); });
    setManagedMember(null);
  };

  const removeServerMember = (member: LocalProfile) => {
    if (!selectedGroup || !profile || selectedGroup.ownerId !== profile.id || !socket) return;
    socket.emit("group:remove-member", { groupId: selectedGroup.id, memberId: member.id, recipientIds: selectedGroup.members.map(item => item.id) }, (result: { ok: boolean; message?: string }) => {
      if (!result.ok) return toast.error(result.message || "Não foi possível remover o membro.");
      setManagedMember(null);
      toast.success(`${member.displayName} foi removido do servidor.`);
    });
  };

  const createChannel = (name: string, kind: "text" | "voice" = "text") => {
    if (!socket || !selectedGroup || !profile || (selectedGroup.ownerId !== profile.id && !(selectedGroup.admins || []).includes(profile.id)) || name.trim().length < 2) return;
    const channel = { id: createId(), name: name.trim().replace(/^#/, ""), kind };
    const updated = { ...selectedGroup, channels: [...selectedGroup.channels, channel] };
    updateStore(current => ({ ...current, groups: current.groups.map(group => group.id === updated.id ? updated : group) }));
    socket.emit("group:update", { recipientIds: updated.members.map(member => member.id), group: updated });
    setShowChannel(false);
  };

  const renameChannel = (channelId: string, name: string) => {
    if (!socket || !selectedGroup || !profile || (selectedGroup.ownerId !== profile.id && !(selectedGroup.admins || []).includes(profile.id))) return;
    const nextName = name.trim().replace(/^#/, "");
    if (nextName.length < 2) return toast.error("O canal precisa ter pelo menos 2 caracteres.");
    const updated = { ...selectedGroup, channels: selectedGroup.channels.map(channel => channel.id === channelId ? { ...channel, name: nextName } : channel) };
    updateStore(current => ({ ...current, groups: current.groups.map(group => group.id === updated.id ? updated : group) }));
    socket.emit("group:update", { recipientIds: updated.members.map(member => member.id), group: updated });
    setActiveRoom(current => current?.groupId === updated.id && current.id === channelRoomId(updated.id, channelId) ? { ...current, title: nextName } : current);
    toast.success("Canal renomeado.");
  };

  const removeChannel = (channelId: string) => {
    if (!socket || !selectedGroup || !profile || (selectedGroup.ownerId !== profile.id && !(selectedGroup.admins || []).includes(profile.id))) return;
    const channel = selectedGroup.channels.find(item => item.id === channelId);
    if (!channel) return;
    if (channel.kind !== "voice" && selectedGroup.channels.filter(item => item.kind !== "voice").length <= 1) return toast.error("O servidor precisa manter pelo menos um canal de texto.");
    const updated = { ...selectedGroup, channels: selectedGroup.channels.filter(item => item.id !== channelId) };
    updateStore(current => ({ ...current, groups: current.groups.map(group => group.id === updated.id ? updated : group) }));
    socket.emit("group:update", { recipientIds: updated.members.map(member => member.id), group: updated });
    if (activeRoom?.groupId === updated.id && activeRoom.id === channelRoomId(updated.id, channelId)) {
      const fallback = updated.channels.find(item => item.kind !== "voice") || updated.channels[0];
      if (fallback) setActiveRoom({ kind: "channel", id: channelRoomId(updated.id, fallback.id), title: fallback.name, groupId: updated.id });
    }
    toast.success("Canal removido.");
  };

  const joinVoiceChannel = (channel: { id: string; name: string }) => {
    if (!selectedGroup || !profile || call.room) return;
    setVoiceChannelTitle(channel.name);
    void call.startCall(voiceRoomId(selectedGroup.id, channel.id), [], false, false, selectedGroup.members.filter(member => member.id !== profile.id).map(member => member.id));
  };

		  const sendMessage = async (directMedia?: LocalAttachment) => {
		    const selectedDirectMedia = isLocalAttachment(directMedia) ? directMedia : null;
		    const nextAttachment = selectedDirectMedia || attachment;
		    const nextBody = selectedDirectMedia ? null : compose.trim() || null;
		    if (!profile || !activeRoom || (!nextBody && !nextAttachment)) return;
		    if (!socket?.connected) return;
		    if (editingMessage) {
		      if (selectedDirectMedia) { toast.error("Conclua ou cancele a edição antes de enviar uma mídia."); return; }
		      if (editingMessage.author.id !== profile.id || editingMessage.deletedAt) return;
	      const recipients = activeRoom.kind === "dm" && activeRoom.partner
	        ? [store.contacts.find(contact => contact.id === activeRoom.partner!.id) || activeRoom.partner]
	        : selectedGroup?.members.map(member => store.contacts.find(contact => contact.id === member.id) || member).filter(member => member.id !== profile.id) || [];
	      const revised: LocalMessage = { ...editingMessage, author: profile, body: compose.trim() || null, attachment: attachment || editingMessage.attachment, editedAt: new Date().toISOString() };
	      try {
	        const encrypted = await encryptMessageForRecipients(profile.id, recipients, { body: revised.body, attachment: revised.attachment, replyTo: revised.replyTo });
	        const outbound: LocalMessage = { ...revised, body: null, attachment: null, encrypted };
	        updateStore(current => ({ ...current, messages: updateMessage(current.messages, revised.roomId, revised.id, () => revised) }));
	        socket.emit("message:edit", { messageId: revised.id, roomId: revised.roomId, message: outbound }, (result: { ok: boolean; message?: string }) => {
	          if (!result?.ok) toast.error(result?.message || "Não foi possível editar a mensagem.");
	        });
	        setCompose("");
	        setAttachment(null);
	        setEditingMessage(null);
	      } catch (error) {
	        toast.error(error instanceof Error ? error.message : "Não foi possível enviar a edição.");
	      }
	      return;
	    }
	    const replyTo = replyingTo ? { id: replyingTo.id, authorName: replyingTo.author.displayName, preview: (replyingTo.body || replyingTo.attachment?.name || "Mensagem").slice(0, 180) } : undefined;
		    const message: LocalMessage = { id: createId(), roomId: activeRoom.id, author: profile, body: nextBody, attachment: nextAttachment, replyTo, createdAt: new Date().toISOString() };
	    const recipients = activeRoom.kind === "dm" && activeRoom.partner
	      ? [store.contacts.find(contact => contact.id === activeRoom.partner!.id) || activeRoom.partner]
	      : selectedGroup?.members.map(member => store.contacts.find(contact => contact.id === member.id) || member).filter(member => member.id !== profile.id) || [];
	    let encrypted;
	    try {
	      encrypted = await encryptMessageForRecipients(profile.id, recipients, { body: message.body, attachment: message.attachment, replyTo });
	    } catch (error) {
	      toast.error(error instanceof Error ? error.message : "Não foi possível enviar a mensagem.");
	      return;
	    }
	    const outbound: LocalMessage = { ...message, body: null, attachment: null, encrypted };
	    updateStore(current => ({ ...current, messages: appendMessage(current.messages, message) }));
	        const attachmentRetention = attachmentRetentionClass(message.attachment);
	        if (activeRoom.kind === "dm" && activeRoom.partner) socket.emit("direct:message", { recipientId: activeRoom.partner.id, message: outbound, attachmentRetention });
	        if (activeRoom.kind === "channel" && selectedGroup) socket.emit("group:message", { recipientIds: selectedGroup.members.map(member => member.id), groupId: selectedGroup.id, message: outbound, attachmentRetention });
		    setCompose("");
		    if (!selectedDirectMedia) setAttachment(null);
	    setReplyingTo(null);
	  };

	  const reactToMessage = (message: LocalMessage, emoji: string) => {
	    if (!socket?.connected || !profile || message.deletedAt) return;
	    updateStore(current => ({ ...current, messages: updateMessage(current.messages, message.roomId, message.id, item => {
	      const people = item.reactions?.[emoji] || [];
	      const nextPeople = people.includes(profile.id) ? people.filter(id => id !== profile.id) : [...people, profile.id];
	      return { ...item, reactions: { ...(item.reactions || {}), [emoji]: nextPeople } };
	    }) }));
	    socket.emit("message:react", { messageId: message.id, roomId: message.roomId, emoji });
	  };

		  const deleteMessage = (message: LocalMessage) => {
		    if (!socket?.connected) return;
		    socket.emit("message:delete", { messageId: message.id, roomId: message.roomId }, (result: { ok: boolean; message?: string }) => {
		      if (!result.ok) toast.error(result.message || "Não foi possível excluir esta mensagem.");
		    });
		  };

		  const editMessage = (message: LocalMessage) => {
		    if (message.author.id !== profile?.id || message.deletedAt) return;
		    setEditingMessage(message);
		    setCompose(message.body || "");
		    setAttachment(message.attachment);
		    setReplyingTo(null);
		  };

		  const markMessageUnread = (message: LocalMessage) => {
		    setUnreadRooms(current => ({ ...current, [message.roomId]: { count: Math.max(1, current[message.roomId]?.count || 0), mentions: current[message.roomId]?.mentions || 0 } }));
		    toast.success("Mensagem marcada como não lida.");
		  };

		  const pinMessage = (message: LocalMessage) => {
		    if (message.deletedAt) return;
		    updateStore(current => ({ ...current, messages: updateMessage(current.messages, message.roomId, message.id, item => ({ ...item, pinnedAt: item.pinnedAt ? undefined : new Date().toISOString() })) }));
		  };

		  const resolveInviteMessage = (message: LocalMessage, accepted: boolean) => {
		    if (!message.groupInvite) return;
		    updateStore(current => ({ ...current, messages: updateMessage(current.messages, message.roomId, message.id, item => ({ ...item, groupInviteStatus: accepted ? "accepted" : "declined" })) }));
		    resolveRequest(message.groupInvite, accepted);
		  };

		if (!profile || upgradingGuest || addingAccount) return <SimplifiedEntryPanel onSubmit={createProfile} />;

  const selectedRoomKey = activeRoom ? `${activeRoom.kind}:${activeRoom.id}` : "";
  const callRecipients = activeRoom?.kind === "dm" && activeRoom.partner ? [activeRoom.partner.id] : selectedGroup?.members.map(member => member.id).filter(id => id !== profile.id) || [];

	  return <div className="mobile-app-shell flex h-[var(--resenha-vvh,100dvh)] overflow-hidden bg-[#11131d] text-slate-100">
	    <aside className="hidden w-[72px] shrink-0 flex-col items-center gap-3 bg-[#0b0d14] py-3 md:flex"><div className="grid h-12 w-12 place-items-center rounded-[17px] bg-[#78b43d] text-lg font-black">R</div><div className="h-px w-8 bg-white/10" /><button onClick={() => { setSelectedGroupId(null); setActiveRoom(null); }} className={`grid h-12 w-12 place-items-center rounded-[17px] transition ${!selectedGroupId ? "bg-violet-500" : "bg-[#1a1d29] hover:bg-violet-500"}`}><Users size={20} /></button>{store.groups.map(group => <button key={group.id} onClick={() => { setSelectedGroupId(group.id); const channel = group.channels[0]; if (channel) setActiveRoom({ kind: "channel", id: channelRoomId(group.id, channel.id), title: channel.name, groupId: group.id }); }} className={`grid h-12 w-12 place-items-center overflow-hidden rounded-[17px] text-sm font-black transition ${selectedGroupId === group.id ? "bg-violet-500 ring-2 ring-violet-300" : "bg-[#1a1d29] hover:bg-violet-500"}`}>{group.imageUrl ? <img src={group.imageUrl} alt={group.name} className="h-full w-full object-cover" /> : initials(group.name)}</button>)}<button onClick={() => setShowGroup(true)} className="grid h-12 w-12 place-items-center rounded-[17px] bg-[#1a1d29] text-emerald-400 transition hover:bg-emerald-500 hover:text-white"><Plus size={21} /></button><div className="mt-auto flex flex-col items-center gap-3"><button type="button" onClick={() => setShowRequests(true)} className="relative grid h-10 w-10 place-items-center rounded-xl bg-[#1a1d29] text-slate-300 transition hover:bg-violet-500 hover:text-white" aria-label="Solicitações"><Bell size={18} />{store.requests.length > 0 && <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-rose-500 px-1 text-[10px] font-black text-white">{store.requests.length}</span>}</button><ProfileAvatar profile={profile} className="h-10 w-10" /></div></aside>
    <section className={`absolute inset-y-0 left-0 z-30 flex w-[300px] flex-col border-r border-white/[.06] bg-[#171a25] pb-[calc(60px+env(safe-area-inset-bottom))] shadow-2xl transition-transform md:static md:translate-x-0 md:pb-0 md:shadow-none ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="flex h-16 items-center justify-between border-b border-white/[.06] px-4"><div className="flex min-w-0 items-center gap-2">{selectedGroup && (selectedGroup.imageUrl ? <img src={selectedGroup.imageUrl} alt="" className="h-8 w-8 rounded-xl object-cover" /> : <span className="grid h-8 w-8 place-items-center rounded-xl bg-violet-500 text-xs font-black">{initials(selectedGroup.name)}</span>)}<div className="min-w-0"><p className="truncate text-sm font-bold">{selectedGroup ? selectedGroup.name : "Mensagens"}</p><p className="text-[11px] text-slate-500">{socket?.connected ? "Diretório Resenha conectado" : "Conectando à Resenha"}</p></div></div><div className="flex items-center gap-1">{selectedGroup?.ownerId === profile.id && <IconButton label="Editar servidor" onClick={() => setShowGroupEdit(true)}><Settings size={16} /></IconButton>}<IconButton label="Fechar menu" onClick={() => setSidebarOpen(false)}><X size={18} /></IconButton></div></div>
      {selectedGroup && <ServerMemberTray group={selectedGroup} onInvite={() => setShowInvite(true)} onOpenMembers={() => setShowMembers(true)} onViewProfile={setViewedProfile} />}
      {!selectedGroup ? <><div className="space-y-2 p-3"><Button onClick={() => setShowContact(true)} className="h-10 w-full rounded-xl bg-violet-500 hover:bg-violet-400"><UserPlus size={16} />Adicionar contato</Button>{profile.accountType === "guest" && <Button variant="outline" onClick={() => setUpgradingGuest(true)} className="h-10 w-full border-violet-400/30 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20 hover:text-white">Criar conta oficial</Button>}<Button onClick={() => setShowRequests(true)} variant="outline" className="relative h-10 w-full border-white/[.1] bg-white/[.03] text-slate-200 hover:bg-white/[.08] hover:text-white"><Bell size={16} />Solicitações{store.requests.length > 0 && <span className="ml-auto rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-black text-white">{store.requests.length}</span>}</Button></div><div className="min-h-0 flex-1 overflow-y-auto px-2"><p className="px-2 pb-2 text-[11px] font-bold uppercase tracking-[.14em] text-slate-500">Contatos — {store.contacts.length}</p>{store.contacts.length ? store.contacts.map(contact => { const online = onlineContactIds.has(contact.id); return <button key={contact.id} onClick={() => openDirect(contact)} className={`mb-1 flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition ${activeRoom?.partner?.id === contact.id ? "bg-white/[.09]" : "hover:bg-white/[.05]"}`}><ProfileAvatar profile={contact} /><span className="min-w-0 flex-1 truncate text-sm font-medium">{contact.displayName}</span><span className={`h-2 w-2 rounded-full transition-colors ${online ? "bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,.12)]" : "bg-slate-600"}`} title={online ? "Online" : "Offline"} aria-label={online ? "Online" : "Offline"} /></button>; }) : <p className="m-2 rounded-xl border border-dashed border-white/[.1] p-4 text-center text-xs leading-5 text-slate-500">Adicione alguém pelo código enquanto a pessoa estiver com a Resenha aberta.</p>}</div></> : <><div className="flex items-center justify-between px-4 py-3"><p className="text-[11px] font-bold uppercase tracking-[.14em] text-slate-500">Canais</p>{(selectedGroup.ownerId === profile.id || (selectedGroup.admins || []).includes(profile.id)) && <div className="flex items-center gap-1"><IconButton label="Gerenciar canais" onClick={() => setShowChannelManager(true)}><MoreHorizontal size={16} /></IconButton><IconButton label="Criar canal" onClick={() => setShowChannel(true)}><Plus size={16} /></IconButton></div>}</div><div className="min-h-0 flex-1 overflow-y-auto px-2"><p className="px-2 pb-2 text-[11px] font-bold uppercase tracking-[.14em] text-slate-500">Texto</p>{selectedGroup.channels.filter(channel => channel.kind !== "voice").map(channel => <button key={channel.id} onClick={() => { setActiveRoom({ kind: "channel", id: channelRoomId(selectedGroup.id, channel.id), title: channel.name, groupId: selectedGroup.id }); setSidebarOpen(false); }} className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition ${activeRoom?.id === channelRoomId(selectedGroup.id, channel.id) ? "bg-white/[.09] font-semibold" : "text-slate-400 hover:bg-white/[.05] hover:text-white"}`}><Hash size={17} className="text-slate-500" />{channel.name}</button>)}<p className="mt-4 px-2 pb-2 text-[11px] font-bold uppercase tracking-[.14em] text-slate-500">Voz</p>{selectedGroup.channels.filter(channel => channel.kind === "voice").map(channel => { const room = voiceRoomId(selectedGroup.id, channel.id); const connected = call.room === room; const live = liveVoiceRooms[room] || (connected && (call.sharingScreen || call.remotePeers.some(peer => peer.sharingScreen))); const participants = voiceParticipants[room] || []; return <div key={channel.id} className="mb-1"><button onClick={() => joinVoiceChannel(channel)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition ${live ? "bg-rose-500/20 text-rose-100 ring-1 ring-rose-500/50" : connected ? "bg-violet-500/20 text-violet-200" : "text-slate-400 hover:bg-white/[.05] hover:text-white"}`}><Volume2 size={17} className={live ? "text-rose-300" : "text-violet-300"} />{channel.name}{live ? <span className="ml-auto inline-flex items-center gap-1 rounded bg-rose-500 px-1.5 py-0.5 text-[9px] font-black tracking-[.1em] text-white"><i className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />LIVE</span> : connected && <span className="ml-auto text-[10px] font-bold">AO VIVO</span>}</button>{participants.map(member => <button type="button" key={member.id} onClick={() => setViewedProfile(member)} className="mt-1 flex w-full items-center gap-2 rounded-lg py-1 pl-8 pr-2 text-left text-xs text-slate-400 transition hover:bg-white/[.04] hover:text-slate-200"><ProfileAvatar profile={member} className="h-5 w-5 rounded-md" /><span className="min-w-0 flex-1 truncate">{member.displayName}</span><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /></button>)}</div>; })}</div></>}
      <div className="m-2 flex items-center gap-2 rounded-xl bg-[#10121a] p-2"><button onClick={() => setShowProfile(true)} className="flex min-w-0 flex-1 items-center gap-2 text-left"><ProfileAvatar profile={profile} className="h-8 w-8" /><span className="min-w-0"><span className="block truncate text-xs font-bold">{profile.displayName}</span><span className="block font-mono text-[10px] text-slate-500">#{profile.connectionCode}</span></span></button><IconButton label="Editar perfil" onClick={() => setShowProfile(true)}><Settings size={16} /></IconButton></div>
	    </section>
	    {unreadTotal > 0 && <button type="button" onClick={() => setSidebarOpen(true)} className="fixed right-4 top-4 z-40 inline-flex items-center gap-1 rounded-full bg-rose-500 px-2.5 py-1.5 text-xs font-black text-white shadow-lg shadow-rose-950/40 md:right-auto md:left-5" aria-label={`${unreadTotal} mensagem(ns) não lida(s)`}>{mentionTotal > 0 ? "@" : "•"} {mentionTotal > 0 ? `${mentionTotal} menção(ões)` : unreadTotal}</button>}
	    {sidebarOpen && <button aria-label="Fechar menu" className="fixed inset-0 z-20 bg-black/45 md:hidden" onClick={() => setSidebarOpen(false)} />}
	    {isAway && <div role="status" className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-amber-300/30 bg-[#24211a] px-3 py-2 text-xs font-semibold text-amber-100 shadow-xl"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" />Você está ausente. A Resenha reconecta quando voltar.</div>}
	    <main className="mobile-chat-main flex min-h-0 min-w-0 flex-1 flex-col bg-[#1a1d28] pb-[calc(60px+env(safe-area-inset-bottom))] md:pb-0">{activeRoom ? <>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-white/[.06] px-3 sm:h-16 sm:gap-3 sm:px-5"><button className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-white/[.07] md:hidden" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button><Hash size={22} className="hidden text-slate-500 sm:block" /><div className="min-w-0 flex-1"><h1 className="truncate text-sm font-bold">{activeRoom.title}</h1><p className="hidden text-xs text-slate-500 sm:block">Guardado localmente neste navegador</p></div>{activeRoom.partner && <IconButton label="Ver perfil" onClick={() => setViewedProfile(activeRoom.partner!)}><Users size={18} /></IconButton>}{selectedGroup && <IconButton label="Ver membros do servidor" onClick={() => setShowMembers(true)}><Users size={18} /></IconButton>}{call.room ? <CallPresenceBadge call={call} currentProfile={profile} /> : observedCall?.participants.length ? <ObservedCallBadge activeCall={observedCall} /> : null}<IconButton label="Chamada de áudio" onClick={() => void call.startCall(selectedRoomKey, callRecipients, false)} disabled={Boolean(call.room) || !callRecipients.length}><Phone size={18} /></IconButton><IconButton label="Chamada de vídeo" onClick={() => void call.startCall(selectedRoomKey, callRecipients, true)} disabled={Boolean(call.room) || !callRecipients.length}><Video size={18} /></IconButton>{activeRoom.kind === "channel" && <IconButton label="Convidar contatos" onClick={() => setShowInvite(true)}><UserPlus size={18} /></IconButton>}</header>
      <div className="flex min-h-0 flex-1"><section className="flex min-h-0 min-w-0 flex-1 flex-col">{observedCall?.participants.length ? <ActiveCallCard activeCall={observedCall} joined={call.room === activeCallRoom} onRestore={call.restoreCall} onJoin={() => void call.startCall(selectedRoomKey, [], false, false, selectedGroup?.members.filter(member => member.id !== profile.id).map(member => member.id) || [])} /> : null}<Messages list={activeMessages} currentUser={profile.id} serverOwnerId={selectedGroup?.ownerId} onProfile={setViewedProfile} onReact={reactToMessage} onDelete={deleteMessage} onEdit={editMessage} onReply={setReplyingTo} onMarkUnread={markMessageUnread} onPin={pinMessage} onResolveInvite={resolveInviteMessage} /><Composer value={compose} onChange={setCompose} attachment={attachment} replyTo={replyingTo} editingMessage={editingMessage} onCancelReply={() => setReplyingTo(null)} onCancelEdit={() => { setEditingMessage(null); setCompose(""); setAttachment(null); }} onRemoveAttachment={() => setAttachment(null)} onAttach={async file => { try { if (file) setAttachment(await fileAsAttachment(file)); } catch (error) { toast.error(error instanceof Error ? error.message : "Arquivo inválido."); } }} onSendMedia={media => { void sendMessage(media); }} onInsertEmoji={emoji => setCompose(current => `${current}${emoji}`)} onSend={sendMessage} room={activeRoom.title} /></section>{selectedGroup && <aside className="hidden w-[225px] border-l border-white/[.06] bg-[#141720] p-4 xl:block"><p className="mb-3 text-[11px] font-bold uppercase tracking-[.14em] text-slate-500">Membros — {selectedGroup.members.length}</p>{selectedGroup.members.map(member => { const serverProfile = selectedGroup.memberProfiles?.[member.id] || {}; const label = serverProfile.displayName || member.displayName; const canManage = selectedGroup.ownerId === profile.id || (selectedGroup.admins || []).includes(profile.id); return <div key={member.id} className="mb-2 flex items-center gap-1 rounded-lg p-1 hover:bg-white/[.05]"><button type="button" onClick={() => setViewedProfile(member)} className="flex min-w-0 flex-1 items-center gap-2 text-left"><ProfileAvatar profile={member} className="h-8 w-8" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-300">{label}</span>{serverProfile.tag && <span style={{ color: serverProfile.tagColor || "#a78bfa" }} className="block truncate text-[10px]">{serverProfile.tag} · {serverProfile.role === "owner" ? "owner" : serverProfile.role === "admin" ? "admin" : "membro"}</span>}</span></button>{canManage && member.id !== profile.id && <button type="button" onClick={() => setManagedMember(member)} className="rounded-md px-1.5 py-1 text-[9px] font-bold text-violet-300 hover:bg-violet-500/20" title="Gerenciar membro">{serverProfile.role === "admin" ? "Admin" : "Gerir"}</button>}</div>; })}</aside>}</div>
    </> : <Welcome profile={profile} onMenu={() => setSidebarOpen(true)} onAdd={() => setShowContact(true)} onGroup={() => setShowGroup(true)} />}</main>
    <MobileGroupRail groups={store.groups} selectedGroupId={selectedGroupId} onMessages={() => { setSelectedGroupId(null); setActiveRoom(null); setSidebarOpen(true); }} onSelectGroup={openGroupFromMobileRail} onCreateGroup={() => setShowGroup(true)} onSettings={() => setShowProfile(true)} />
	    {call.room && call.localStream && !call.minimized && <CallView call={call} title={voiceChannelTitle || activeRoom?.title || "Chamada"} currentProfile={profile} />}
    {call.incomingCall && <IncomingCallModal call={call} />}
	    {showProfile && <ProfileModal profile={profile} onClose={() => setShowProfile(false)} onManageAccounts={() => { setShowProfile(false); setShowAccounts(true); }} onSave={next => { updateStore(current => replaceProfileEverywhere(current, next)); setShowProfile(false); }} />}
    {showContact && <ContactModal accountType={profile.accountType || "guest"} onClose={() => setShowContact(false)} onAdd={addContact} onAddUsername={addContactByUsername} />}
    {showRequests && <RequestsModal requests={store.requests} onClose={() => setShowRequests(false)} onResolve={resolveRequest} />}
    {showAccounts && profile && <AccountManagerModal currentId={profile.id} accounts={accountVault} switchingAccount={switchingAccount} onClose={() => setShowAccounts(false)} onAdd={beginAddAccount} onSwitch={switchAccount} onLogout={logoutCurrentAccount} onCancelSwitch={() => setSwitchingAccount(null)} />}
    {showGroup && <GroupModal onClose={() => setShowGroup(false)} onCreate={createGroup} />}
    {showInvite && <InviteModal contacts={store.contacts} memberIds={selectedGroup?.members.map(member => member.id) || []} onClose={() => setShowInvite(false)} onInvite={inviteToGroup} />}
    {showMembers && selectedGroup && <GroupMembersModal group={selectedGroup} currentProfile={profile} canManage={selectedGroup.ownerId === profile.id || (selectedGroup.admins || []).includes(profile.id)} onClose={() => setShowMembers(false)} onViewProfile={member => { setShowMembers(false); setViewedProfile(member); }} onManage={member => { setShowMembers(false); setManagedMember(member); }} />}
    {showChannelManager && selectedGroup && <ChannelManagerModal channels={selectedGroup.channels} onClose={() => setShowChannelManager(false)} onRename={renameChannel} onRemove={removeChannel} />}
    {showGroupEdit && selectedGroup && <GroupModal initial={selectedGroup} onClose={() => setShowGroupEdit(false)} onCreate={updateGroupIdentity} />}
    {showChannel && <ChannelModal onClose={() => setShowChannel(false)} onCreate={createChannel} />}
	    {managedMember && selectedGroup && <ServerMemberManagerModal member={managedMember} serverProfile={selectedGroup.memberProfiles?.[managedMember.id]} canChangeRole={selectedGroup.ownerId === profile.id} onClose={() => setManagedMember(null)} onSave={(values: { role: "admin" | "member"; displayName: string; tag: string; tagColor: string }) => saveServerMember(managedMember, values)} onRemove={selectedGroup.ownerId === profile.id ? () => removeServerMember(managedMember) : undefined} />}
    {viewedProfile && <ProfileViewer profile={viewedProfile} serverProfile={selectedGroup?.memberProfiles?.[viewedProfile.id]} ownId={profile.id} onClose={() => setViewedProfile(null)} onMessage={() => { openDirect(viewedProfile); setViewedProfile(null); }} />}
	    <InstallAppPrompt available={Boolean(installPrompt) && !isInstalled} platform={!isInstalled ? mobilePlatform : null} mobileReleaseUrl={!isInstalled ? mobileReleaseUrl : null} iosInstallUrl={!isInstalled ? iosReleaseUrl : null} onInstall={() => void requestAppInstall()} onDownload={() => { if (mobilePlatform === "ios" && !iosReleaseUrl) { setShowIosInstallHelp(true); return; } const target = mobilePlatform === "ios" ? iosReleaseUrl : mobileReleaseUrl; if (target) window.open(target, "_blank", "noopener,noreferrer"); }} />
	    {showIosInstallHelp && <IosInstallHelp onClose={() => setShowIosInstallHelp(false)} />}
    <NotificationPermissionPrompt permission={notificationPermission} onEnable={() => void requestBrowserNotifications()} />
  </div>;
}

function SimplifiedEntryPanel({ onSubmit }: { onSubmit: (event: React.FormEvent<HTMLFormElement>) => void | Promise<void> }) {
  const [mode, setMode] = useState<"guest" | "official">("official");
  const [intent, setIntent] = useState<"register" | "login">("register");
  const [showPassword, setShowPassword] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const passwordType = showPassword ? "text" : "password";
  const field = (confirmation = false) => <div className="relative mt-2"><Input name={confirmation ? "passwordConfirmation" : "password"} type={passwordType} required minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} pattern={PASSWORD_HTML_PATTERN} autoComplete={intent === "login" ? "current-password" : "new-password"} className="h-11 border-white/[.09] bg-[#11131d] pr-11 text-white" placeholder={confirmation ? "Repita sua senha" : "Senha"} /><button type="button" onClick={() => setShowPassword(value => !value)} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-slate-400 hover:text-white" aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>;
  const register = () => { setMode("official"); setIntent("register"); };
  const login = () => { setMode("official"); setIntent("login"); };

  return <main className="grid min-h-dvh place-items-center overflow-hidden bg-[#10121a] px-4"><div className="absolute -left-24 -top-28 h-80 w-80 rounded-full bg-violet-600/25 blur-3xl" /><form onSubmit={event => { void onSubmit(event); }} className="orbit-enter relative w-full max-w-[470px] rounded-[28px] border border-white/[.09] bg-[#1c1f2c]/90 p-8 shadow-2xl"><div className="flex items-center gap-3"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#78b43d] text-lg font-black">R</div><div><p className="font-bold text-white">Resenha Chat</p><p className="text-xs text-slate-400">Conversa privada e simples</p></div></div>{mode === "official" ? <><h1 className="mt-8 text-2xl font-bold text-white">{intent === "register" ? "Crie sua conta." : "Entre na sua conta."}</h1><p className="mt-2 text-sm leading-6 text-slate-400">{intent === "register" ? "Escolha um nome de usuário e uma senha para acessar a Resenha em qualquer dispositivo." : "Use os dados salvos no seu gerenciador de senhas, se houver."}</p><input type="hidden" name="mode" value="official" /><input type="hidden" name="intent" value={intent} /><label className="mt-6 block text-xs font-bold uppercase tracking-[.12em] text-slate-400">Nome de usuário<Input name="username" required minLength={USERNAME_MIN_LENGTH} maxLength={USERNAME_MAX_LENGTH} pattern={USERNAME_HTML_PATTERN} autoComplete="username" className="mt-2 h-11 border-white/[.09] bg-[#11131d] text-white" placeholder="Escolha um nome de usuário" /></label><label className="mt-4 block text-xs font-bold uppercase tracking-[.12em] text-slate-400">Senha{field()}</label>{intent === "register" && <label className="mt-4 block text-xs font-bold uppercase tracking-[.12em] text-slate-400">Repita a senha{field(true)}</label>}<Button className="mt-6 h-11 w-full rounded-xl bg-violet-500 font-bold hover:bg-violet-400">{intent === "login" ? "Entrar" : "Criar conta"}</Button><div className="mt-5 border-t border-white/[.08] pt-4 text-center text-xs text-slate-500">{intent === "register" ? <>Já tem uma conta? <button type="button" onClick={login} className="font-bold text-violet-300 hover:text-violet-200">Entrar</button></> : <>Ainda não tem conta? <button type="button" onClick={register} className="font-bold text-violet-300 hover:text-violet-200">Criar conta</button></>}<span className="mx-2 text-slate-700">·</span><button type="button" onClick={() => setMode("guest")} className="font-bold text-slate-300 hover:text-white">Se juntar como um Guest</button></div></> : <><h1 className="mt-8 text-2xl font-bold text-white">Se juntar como um Guest.</h1><p className="mt-2 text-sm leading-6 text-slate-400">Crie uma identidade local para começar agora.</p><input type="hidden" name="mode" value="guest" /><div className="mt-5 flex items-center gap-4 rounded-2xl border border-white/[.08] bg-white/[.025] p-3"><ProfileAvatar profile={{ displayName: "Sua foto", avatarUrl: avatarPreview }} className="h-16 w-16 rounded-2xl" /><label className="cursor-pointer rounded-xl bg-white/[.08] px-3 py-2 text-xs font-bold text-slate-200 transition hover:bg-white/[.13]"><input name="avatar" type="file" accept="image/*" className="hidden" onChange={event => { const file = event.target.files?.[0]; setAvatarPreview(file ? URL.createObjectURL(file) : null); }} />Adicionar foto</label></div><label className="mt-6 block text-xs font-bold uppercase tracking-[.12em] text-slate-400">Nome de exibição<Input name="name" required minLength={2} maxLength={64} className="mt-2 h-11 border-white/[.09] bg-[#11131d] text-white" placeholder="Como as pessoas vão te chamar?" /></label><label className="mt-4 block text-xs font-bold uppercase tracking-[.12em] text-slate-400">Descrição <span className="normal-case font-normal text-slate-600">(opcional)</span><Textarea name="bio" maxLength={280} className="mt-2 min-h-24 resize-none border-white/[.09] bg-[#11131d] text-white" placeholder="Conte brevemente quem você é." /></label><Button className="mt-6 h-11 w-full rounded-xl bg-violet-500 font-bold hover:bg-violet-400">Continuar</Button><div className="mt-5 border-t border-white/[.08] pt-4 text-center text-xs text-slate-500">Prefere usar um nome de usuário? <button type="button" onClick={register} className="font-bold text-violet-300 hover:text-violet-200">Criar conta</button><span className="mx-2 text-slate-700">·</span><button type="button" onClick={login} className="font-bold text-slate-300 hover:text-white">Já tenho conta</button></div></>}</form></main>;
}

function EntryPanel({ onSubmit }: { onSubmit: (event: React.FormEvent<HTMLFormElement>) => void | Promise<void> }) {
  const [mode, setMode] = useState<"guest" | "official">("official");
  const [intent, setIntent] = useState<"register" | "login">("register");
  const [showPassword, setShowPassword] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const passwordType = showPassword ? "text" : "password";
  const switchToRegister = () => { setMode("official"); setIntent("register"); };
  const switchToLogin = () => { setMode("official"); setIntent("login"); };

  const passwordField = (confirmation = false) => <div className="relative mt-2"><Input name={confirmation ? "passwordConfirmation" : "password"} type={passwordType} required minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} pattern={PASSWORD_HTML_PATTERN} autoComplete={intent === "login" ? "current-password" : "new-password"} className="h-11 border-white/[.09] bg-[#11131d] pr-11 text-white" placeholder={confirmation ? "Repita sua senha" : "Senha"} /><button type="button" onClick={() => setShowPassword(current => !current)} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-slate-400 hover:text-white" aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>;

  return <main className="grid min-h-dvh place-items-center overflow-hidden bg-[#10121a] px-4"><div className="absolute -left-24 -top-28 h-80 w-80 rounded-full bg-violet-600/25 blur-3xl" /><form onSubmit={event => { void onSubmit(event); }} className="orbit-enter relative w-full max-w-[470px] rounded-[28px] border border-white/[.09] bg-[#1c1f2c]/90 p-8 shadow-2xl"><div className="flex items-center gap-3"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 text-lg font-black">R</div><div><p className="font-bold text-white">Resenha Chat</p><p className="text-xs text-slate-400">Conversa privada e simples</p></div></div>{mode === "official" ? <><p className="mt-7 text-[11px] font-bold uppercase tracking-[.16em] text-violet-300">Conta oficial</p><h1 className="mt-2 text-2xl font-bold text-white">{intent === "register" ? "Crie sua conta." : "Entre na sua conta."}</h1><p className="mt-2 text-sm leading-6 text-slate-400">{intent === "register" ? "Use um nome de usuário e uma senha para acessar a Resenha em qualquer dispositivo." : "Use os dados salvos no seu gerenciador de senhas, se houver."}</p><input type="hidden" name="mode" value="official" /><input type="hidden" name="intent" value={intent} /><label className="mt-6 block text-xs font-bold uppercase tracking-[.12em] text-slate-400">Nome de usuário<Input name="username" required minLength={USERNAME_MIN_LENGTH} maxLength={USERNAME_MAX_LENGTH} pattern={USERNAME_HTML_PATTERN} autoComplete="username" className="mt-2 h-11 border-white/[.09] bg-[#11131d] text-white" placeholder="Escolha um nome de usuário" /></label><label className="mt-4 block text-xs font-bold uppercase tracking-[.12em] text-slate-400">Senha{passwordField()}</label>{intent === "register" && <label className="mt-4 block text-xs font-bold uppercase tracking-[.12em] text-slate-400">Repita a senha{passwordField(true)}</label>}<Button className="mt-6 h-11 w-full rounded-xl bg-violet-500 font-bold hover:bg-violet-400">{intent === "login" ? "Entrar" : "Criar conta"}</Button><div className="mt-5 border-t border-white/[.08] pt-4 text-center text-xs text-slate-500">{intent === "register" ? <>Já tem uma conta? <button type="button" onClick={switchToLogin} className="font-bold text-violet-300 hover:text-violet-200">Entrar</button></> : <>Ainda não tem conta? <button type="button" onClick={switchToRegister} className="font-bold text-violet-300 hover:text-violet-200">Criar conta</button></>}<span className="mx-2 text-slate-700">·</span><button type="button" onClick={() => setMode("guest")} className="font-bold text-slate-300 hover:text-white">Se juntar como um Guest</button></div></> : <><p className="mt-7 text-[11px] font-bold uppercase tracking-[.16em] text-violet-300">Acesso rápido</p><h1 className="mt-2 text-2xl font-bold text-white">Se juntar como um Guest.</h1><p className="mt-2 text-sm leading-6 text-slate-400">Crie uma identidade local para começar agora. Você poderá criar uma conta depois.</p><input type="hidden" name="mode" value="guest" /><div className="mt-5 flex items-center gap-4 rounded-2xl border border-white/[.08] bg-white/[.025] p-3"><ProfileAvatar profile={{ displayName: "Sua foto", avatarUrl: avatarPreview }} className="h-16 w-16 rounded-2xl" /><label className="cursor-pointer rounded-xl bg-white/[.08] px-3 py-2 text-xs font-bold text-slate-200 transition hover:bg-white/[.13]"><input name="avatar" type="file" accept="image/*" className="hidden" onChange={event => { const file = event.target.files?.[0]; setAvatarPreview(file ? URL.createObjectURL(file) : null); }} />Adicionar foto</label></div><label className="mt-6 block text-xs font-bold uppercase tracking-[.12em] text-slate-400">Nome de exibição<Input name="name" required minLength={2} maxLength={64} className="mt-2 h-11 border-white/[.09] bg-[#11131d] text-white" placeholder="Como as pessoas vão te chamar?" /></label><label className="mt-4 block text-xs font-bold uppercase tracking-[.12em] text-slate-400">Descrição <span className="normal-case font-normal text-slate-600">(opcional)</span><Textarea name="bio" maxLength={280} className="mt-2 min-h-24 resize-none border-white/[.09] bg-[#11131d] text-white" placeholder="Conte brevemente quem você é." /></label><Button className="mt-6 h-11 w-full rounded-xl bg-violet-500 font-bold hover:bg-violet-400">Continuar</Button><div className="mt-5 border-t border-white/[.08] pt-4 text-center text-xs text-slate-500">Prefere uma conta oficial? <button type="button" onClick={switchToRegister} className="font-bold text-violet-300 hover:text-violet-200">Criar conta</button><span className="mx-2 text-slate-700">·</span><button type="button" onClick={switchToLogin} className="font-bold text-slate-300 hover:text-white">Já tenho conta</button></div></>}</form></main>;
}

function Onboarding({ onSubmit, defaultMode = "official" }: { onSubmit: (event: React.FormEvent<HTMLFormElement>) => void | Promise<void>; defaultMode?: "guest" | "official" }) {
  const [mode, setMode] = useState<"guest" | "official">(defaultMode);
  const [intent, setIntent] = useState<"register" | "login">("register");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const showOfficial = () => { setMode("official"); setIntent("register"); };
  const showLogin = () => { setMode("official"); setIntent("login"); };

  return <main className="grid min-h-dvh place-items-center overflow-hidden bg-[#10121a] px-4"><div className="absolute -left-24 -top-28 h-80 w-80 rounded-full bg-violet-600/25 blur-3xl" /><form onSubmit={event => { void onSubmit(event); }} className="orbit-enter relative w-full max-w-[470px] rounded-[28px] border border-white/[.09] bg-[#1c1f2c]/90 p-8 shadow-2xl"><div className="flex items-center gap-3"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 text-lg font-black">R</div><div><p className="font-bold text-white">Resenha Chat</p><p className="text-xs text-slate-400">Conversa privada e simples</p></div></div>{mode === "official" ? <><p className="mt-7 text-[11px] font-bold uppercase tracking-[.16em] text-violet-300">Conta oficial</p><h1 className="mt-2 text-2xl font-bold text-white">{intent === "register" ? "Crie sua conta." : "Bem-vindo de volta."}</h1><p className="mt-2 text-sm leading-6 text-slate-400">{intent === "register" ? "Escolha seu nome de usuário e uma senha para entrar na Resenha em qualquer dispositivo." : "Entre com o nome de usuário e a senha da sua conta oficial."}</p><input type="hidden" name="mode" value="official" /><input type="hidden" name="intent" value={intent} /><label className="mt-6 block text-xs font-bold uppercase tracking-[.12em] text-slate-400">Nome de usuário<Input name="username" required minLength={USERNAME_MIN_LENGTH} maxLength={USERNAME_MAX_LENGTH} pattern={USERNAME_HTML_PATTERN} title={usernameRuleMessage} className="mt-2 h-11 border-white/[.09] bg-[#11131d] text-white" placeholder="nome.usuario_1" /><span className="mt-1 block normal-case font-normal tracking-normal text-[10px] text-slate-500">4–20 caracteres: letras, números, ponto ou _; sem espaços.</span></label><label className="mt-4 block text-xs font-bold uppercase tracking-[.12em] text-slate-400">Senha<Input name="password" type="password" required minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} pattern={PASSWORD_HTML_PATTERN} title={passwordRuleMessage} className="mt-2 h-11 border-white/[.09] bg-[#11131d] text-white" placeholder="8–64: letras, números e ! @ # $ % & * _ . -" /></label>{intent === "register" && <label className="mt-4 block text-xs font-bold uppercase tracking-[.12em] text-slate-400">Repita a senha<Input name="passwordConfirmation" type="password" required minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} pattern={PASSWORD_HTML_PATTERN} title={passwordRuleMessage} className="mt-2 h-11 border-white/[.09] bg-[#11131d] text-white" placeholder="Digite a mesma senha novamente" /><span className="mt-1 block normal-case font-normal tracking-normal text-[10px] text-slate-500">{passwordRuleMessage}</span></label>}<Button className="mt-6 h-11 w-full rounded-xl bg-violet-500 font-bold hover:bg-violet-400">{intent === "login" ? "Entrar" : "Criar conta oficial"}</Button><div className="mt-5 border-t border-white/[.08] pt-4 text-center text-xs text-slate-500">{intent === "register" ? <>Já tem uma conta? <button type="button" onClick={showLogin} className="font-bold text-violet-300 hover:text-violet-200">Entrar</button></> : <>Ainda não tem conta? <button type="button" onClick={showOfficial} className="font-bold text-violet-300 hover:text-violet-200">Criar conta</button></>}<span className="mx-2 text-slate-700">·</span><button type="button" onClick={() => setMode("guest")} className="font-bold text-slate-300 hover:text-white">Entrar como Guest</button></div></> : <><p className="mt-7 text-[11px] font-bold uppercase tracking-[.16em] text-violet-300">Acesso rápido</p><h1 className="mt-2 text-2xl font-bold text-white">Entrar como Guest.</h1><p className="mt-2 text-sm leading-6 text-slate-400">Use uma identidade local para começar agora. Você poderá criar uma conta oficial depois.</p><input type="hidden" name="mode" value="guest" /><div className="mt-5 flex items-center gap-4 rounded-2xl border border-white/[.08] bg-white/[.025] p-3"><ProfileAvatar profile={{ displayName: "Sua foto", avatarUrl: avatarPreview }} className="h-16 w-16 rounded-2xl" /><label className="cursor-pointer rounded-xl bg-white/[.08] px-3 py-2 text-xs font-bold text-slate-200 transition hover:bg-white/[.13]"><input name="avatar" type="file" accept="image/*" className="hidden" onChange={event => { const file = event.target.files?.[0]; setAvatarPreview(file ? URL.createObjectURL(file) : null); }} />Adicionar foto <span className="block pt-0.5 text-[10px] font-normal text-slate-500">Opcional · até 5 MB</span></label></div><label className="mt-6 block text-xs font-bold uppercase tracking-[.12em] text-slate-400">Nome de exibição<Input name="name" required minLength={2} maxLength={64} className="mt-2 h-11 border-white/[.09] bg-[#11131d] text-white" placeholder="Como as pessoas vão te chamar?" /></label><label className="mt-4 block text-xs font-bold uppercase tracking-[.12em] text-slate-400">Descrição <span className="normal-case font-normal text-slate-600">(opcional)</span><Textarea name="bio" maxLength={280} className="mt-2 min-h-24 resize-none border-white/[.09] bg-[#11131d] text-white" placeholder="Conte brevemente quem você é." /></label><Button className="mt-6 h-11 w-full rounded-xl bg-violet-500 font-bold hover:bg-violet-400">Continuar como Guest</Button><div className="mt-5 border-t border-white/[.08] pt-4 text-center text-xs text-slate-500">Prefere proteger sua conta? <button type="button" onClick={showOfficial} className="font-bold text-violet-300 hover:text-violet-200">Criar conta oficial</button><span className="mx-2 text-slate-700">·</span><button type="button" onClick={showLogin} className="font-bold text-slate-300 hover:text-white">Já tenho conta</button></div></>}</form></main>;
}

function Welcome({ profile, onMenu, onAdd, onGroup }: { profile: LocalProfile; onMenu: () => void; onAdd: () => void; onGroup: () => void }) {
  return <div className="flex h-full flex-col"><header className="flex h-16 items-center border-b border-white/[.06] px-4 md:hidden"><button className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-white/[.07]" onClick={onMenu}><Menu size={20} /></button></header><div className="grid flex-1 place-items-center p-6"><div className="orbit-enter max-w-lg text-center"><div className="mx-auto grid h-20 w-20 place-items-center rounded-[28px] bg-gradient-to-br from-violet-500 to-indigo-600 text-3xl font-black">R</div><h1 className="mt-7 text-3xl font-bold">Boas-vindas, {profile.displayName}.</h1><p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-400">Adicione um contato pelo código ou crie um grupo para começar.</p><div className="mt-6 flex flex-wrap justify-center gap-3"><Button onClick={onAdd} className="rounded-xl bg-violet-500 hover:bg-violet-400"><UserPlus size={16} />Adicionar contato</Button><Button onClick={onGroup} variant="outline" className="rounded-xl border-white/[.1] bg-white/[.03] text-slate-200 hover:bg-white/[.08] hover:text-white"><FolderPlus size={16} />Criar grupo</Button></div></div></div></div>;
}

function GroupInviteCard({ request, onResolve, outgoing = false, status }: { request: LocalRequest; onResolve: (accepted: boolean) => void; outgoing?: boolean; status?: "accepted" | "declined" }) {
  const group = request.group;
  const memberCount = group?.members.length || 0;
  const outcome = status === "accepted" ? "Você entrou neste servidor" : status === "declined" ? "Convite recusado" : null;
  return <div className="mt-2 max-w-sm overflow-hidden rounded-2xl border border-violet-300/20 bg-[#222534] shadow-lg shadow-black/15"><div className="h-12 bg-gradient-to-r from-[#78b43d] via-emerald-500 to-cyan-500" /><div className="relative p-3 pt-0"><div className="-mt-7 grid h-14 w-14 place-items-center overflow-hidden rounded-2xl border-4 border-[#222534] bg-violet-500 text-sm font-black text-white">{group?.imageUrl ? <img src={group.imageUrl} alt="" className="h-full w-full object-cover" /> : initials(group?.name || "G")}</div><p className="mt-2 text-sm font-black text-white">{group?.name || "Convite para grupo"}</p><p className="mt-0.5 text-xs text-slate-400">{memberCount} {memberCount === 1 ? "membro" : "membros"} · convite da Resenha</p><p className="mt-3 text-xs leading-5 text-slate-300">{outgoing ? "Você enviou um convite para este servidor." : "Entre para participar da conversa, canais e chamadas deste servidor."}</p>{outcome ? <div className={`mt-3 rounded-lg px-3 py-2 text-center text-xs font-bold ${status === "accepted" ? "bg-emerald-500/15 text-emerald-200" : "bg-white/[.06] text-slate-300"}`}>{outcome}</div> : outgoing ? <div className="mt-3 rounded-lg bg-white/[.06] px-3 py-2 text-center text-xs font-bold text-violet-200">Convite enviado</div> : <div className="mt-3 grid grid-cols-2 gap-2"><Button onClick={() => onResolve(true)} className="h-9 rounded-lg bg-emerald-500 text-xs hover:bg-emerald-400">Entrar</Button><Button onClick={() => onResolve(false)} variant="outline" className="h-9 rounded-lg border-white/[.12] text-xs text-slate-200 hover:bg-white/[.08]">Recusar</Button></div>}</div></div>;
}

function GroupMembersModal({ group, currentProfile, canManage, onClose, onViewProfile, onManage }: { group: LocalGroup; currentProfile: LocalProfile; canManage: boolean; onClose: () => void; onViewProfile: (member: LocalProfile) => void; onManage: (member: LocalProfile) => void }) {
  return <Modal onClose={onClose}><div className="flex items-start justify-between"><div className="flex min-w-0 items-center gap-3"><div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-violet-500 text-sm font-black">{group.imageUrl ? <img src={group.imageUrl} alt="" className="h-full w-full object-cover" /> : initials(group.name)}</div><div className="min-w-0"><h2 className="truncate text-lg font-bold">{group.name}</h2><p className="text-sm text-slate-400">{group.members.length} {group.members.length === 1 ? "membro" : "membros"}</p></div></div><IconButton label="Fechar membros" onClick={onClose}><X size={18} /></IconButton></div><div className="mt-5 max-h-[55dvh] space-y-1 overflow-y-auto rounded-xl border border-white/[.08] bg-[#11131d] p-1.5">{group.members.map(member => { const serverProfile = group.memberProfiles?.[member.id] || {}; const label = serverProfile.displayName || member.displayName; const role = serverProfile.role === "owner" ? "Dono" : serverProfile.role === "admin" ? "Administrador" : "Membro"; return <div key={member.id} className="flex items-center gap-1 rounded-xl p-1 transition hover:bg-white/[.06]"><button type="button" onClick={() => onViewProfile(member)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1.5 text-left"><ProfileAvatar profile={member} className="h-10 w-10" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-slate-100">{label}</span><span style={{ color: serverProfile.tagColor || "#94a3b8" }} className="block truncate text-[11px]">{serverProfile.tag || role}</span></span></button>{canManage && member.id !== currentProfile.id && <button type="button" onClick={() => onManage(member)} className="rounded-lg px-2 py-1.5 text-[10px] font-bold text-violet-200 hover:bg-violet-500/20">Gerir</button>}</div>; })}</div></Modal>;
}

function Messages({ list, currentUser, serverOwnerId, onProfile, onReact, onDelete, onEdit, onReply, onMarkUnread, onPin, onResolveInvite }: { list: LocalMessage[]; currentUser: string; serverOwnerId?: string; onProfile: (profile: LocalProfile) => void; onReact: (message: LocalMessage, emoji: string) => void; onDelete: (message: LocalMessage) => void; onEdit: (message: LocalMessage) => void; onReply: (message: LocalMessage) => void; onMarkUnread: (message: LocalMessage) => void; onPin: (message: LocalMessage) => void; onResolveInvite: (message: LocalMessage, accepted: boolean) => void }) {
  const end = useRef<HTMLDivElement>(null);
  const holdTimer = useRef<number | null>(null);
  const touchStart = useRef<{ x: number; y: number; messageId: string } | null>(null);
  const [actionMessage, setActionMessage] = useState<LocalMessage | null>(null);
  const reactionChoices = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🔥", "🎉", "👀", "💀", "🤔", "😡", "✅", "👏", "💚", "🚀"];
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [list.length]);
  useEffect(() => () => { if (holdTimer.current) window.clearTimeout(holdTimer.current); }, []);
  useEffect(() => { if (actionMessage && list.find(message => message.id === actionMessage.id)?.deletedAt) setActionMessage(null); }, [actionMessage, list]);
  useEffect(() => {
    const blockRecordedAudioDownload = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!actionMessage?.attachment?.recordedInApp || !target?.closest('button[aria-label="Salvar"]')) return;
      event.preventDefault();
      event.stopPropagation();
      toast.info("Áudios gravados na Resenha não podem ser baixados.");
    };
    document.addEventListener("click", blockRecordedAudioDownload, true);
    return () => document.removeEventListener("click", blockRecordedAudioDownload, true);
  }, [actionMessage?.attachment?.recordedInApp]);
  const canDelete = (message: LocalMessage) => !message.deletedAt && (serverOwnerId === currentUser || (message.author.id === currentUser && Date.now() - Date.parse(message.createdAt) <= 15 * 60 * 1000));
  const cancelHold = () => { if (holdTimer.current) window.clearTimeout(holdTimer.current); holdTimer.current = null; };
  if (!list.length) return <div className="grid flex-1 place-items-center p-6 text-center"><div><Hash className="mx-auto text-violet-400" size={28} /><p className="mt-3 text-sm font-bold">Este é o começo da conversa.</p><p className="mt-1 text-xs text-slate-500">Envie uma mensagem para começar.</p></div></div>;
  return <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-6 sm:py-5">{list.map(message => <article key={message.id} onContextMenu={event => { if (!message.deletedAt) { event.preventDefault(); setActionMessage(message); } }} onPointerDown={event => { if (message.deletedAt || (event.pointerType === "mouse" && event.button !== 0)) return; touchStart.current = { x: event.clientX, y: event.clientY, messageId: message.id }; cancelHold(); holdTimer.current = window.setTimeout(() => setActionMessage(message), 700); }} onPointerUp={() => { touchStart.current = null; cancelHold(); }} onPointerCancel={() => { touchStart.current = null; cancelHold(); }} onPointerMove={event => { const start = touchStart.current; if (!start || start.messageId !== message.id) return; const dx = event.clientX - start.x; const dy = event.clientY - start.y; if (dx > 68 && Math.abs(dy) < 48) { cancelHold(); touchStart.current = null; onReply(message); navigator.vibrate?.(12); } else if (Math.abs(dx) > 14 || Math.abs(dy) > 14) cancelHold(); }} className="group flex touch-pan-y gap-3 rounded-xl px-1 py-2 transition hover:bg-white/[.025] sm:px-2 sm:py-2.5"><button type="button" onClick={() => onProfile(message.author)} aria-label={`Ver perfil de ${message.author.displayName}`}><ProfileAvatar profile={message.author} /></button><div className="min-w-0 flex-1"><div className="flex items-baseline gap-2"><button type="button" onClick={() => onProfile(message.author)} className={`text-sm font-bold hover:underline ${message.author.id === currentUser ? "text-violet-300" : "text-slate-100"}`}>{message.author.displayName}</button><time className="text-[10px] text-slate-600">{new Date(message.createdAt).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}</time>{message.editedAt && <span className="text-[10px] text-slate-600">editada</span>}{message.pinnedAt && <Pin size={12} className="text-violet-300" />}{!message.deletedAt && <span className="ml-auto hidden items-center gap-1 group-hover:flex"><button type="button" onClick={() => setActionMessage(message)} className="rounded-md p-1 text-slate-400 hover:bg-violet-500/20 hover:text-violet-200" aria-label="Mais ações"><Smile size={14} /></button>{canDelete(message) && <button type="button" onClick={() => onDelete(message)} className="rounded-md p-1 text-slate-400 hover:bg-rose-500/20 hover:text-rose-200" aria-label="Excluir mensagem"><Trash2 size={14} /></button>}</span>}</div>{message.deletedAt ? <p className="mt-1 text-sm italic text-slate-500">Mensagem excluída</p> : <>{message.replyTo && <div className="mt-1 flex min-w-0 items-center gap-1.5 border-l-2 border-violet-400/70 pl-2 text-xs text-slate-400"><CornerUpLeft size={13} className="shrink-0 text-violet-300" /><span className="font-semibold text-violet-200">{message.replyTo.authorName}</span><span className="truncate">{message.replyTo.preview}</span></div>}{message.groupInvite && <GroupInviteCard request={message.groupInvite} outgoing={message.author.id === currentUser} status={message.groupInviteStatus} onResolve={accepted => onResolveInvite(message, accepted)} />}{message.body && <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-5 text-slate-300 sm:leading-6">{linkifyMessage(message.body)}</p>}{message.attachment && <AttachmentView attachment={message.attachment} />}</>}{!message.deletedAt && message.reactions && Object.entries(message.reactions).filter(([, people]) => people.length > 0).length > 0 && <div className="mt-2 flex flex-wrap gap-1">{Object.entries(message.reactions).filter(([, people]) => people.length > 0).map(([emoji, people]) => <button type="button" key={emoji} onClick={() => onReact(message, emoji)} className={`rounded-lg border px-1.5 py-0.5 text-xs ${people.includes(currentUser) ? "border-violet-400/50 bg-violet-500/20 text-violet-100" : "border-white/[.1] bg-white/[.04] text-slate-300"}`}>{emoji} {people.length}</button>)}</div>}{message.attachmentUnavailable && <p className="mt-2 inline-flex rounded-lg border border-amber-300/20 bg-amber-300/10 px-2 py-1 text-[10px] font-medium text-amber-100">O anexo não pôde ser salvo neste dispositivo por falta de espaço.</p>}</div></article>)}{actionMessage && !actionMessage.deletedAt && <div className="fixed inset-x-4 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[60] mx-auto max-w-sm rounded-[28px] border border-white/[.12] bg-[#252938] p-3 shadow-2xl"><div className="mb-2 flex items-center justify-between"><span className="text-xs font-bold text-slate-300">Reagir à mensagem</span><IconButton label="Fechar ações" onClick={() => setActionMessage(null)} className="h-8 w-8"><X size={16} /></IconButton></div><div className="grid grid-cols-8 gap-1">{reactionChoices.map(emoji => <button type="button" key={emoji} onClick={() => { onReact(actionMessage, emoji); setActionMessage(null); }} className="grid aspect-square place-items-center rounded-lg text-xl transition hover:bg-violet-500/25">{emoji}</button>)}</div><p className="mt-3 px-1 text-center text-xs text-slate-400">Toque duas vezes para reagir · pressione para mais ações</p><div className="mt-3 grid grid-cols-2 gap-2"><Button type="button" onClick={() => { onReply(actionMessage); setActionMessage(null); }} variant="outline" className="border-white/[.12] text-slate-100"><CornerUpLeft size={16} />Responder</Button><Button type="button" onClick={() => { navigator.share?.({ text: actionMessage.body || actionMessage.attachment?.name || "Mensagem" }).catch(() => undefined); setActionMessage(null); }} variant="outline" className="border-white/[.12] text-slate-100"><Forward size={16} />Encaminhar</Button>{actionMessage.author.id === currentUser && <Button type="button" onClick={() => { onEdit(actionMessage); setActionMessage(null); }} variant="outline" className="border-white/[.12] text-slate-100"><Pencil size={16} />Editar</Button>}<Button type="button" onClick={() => { onMarkUnread(actionMessage); setActionMessage(null); }} variant="outline" className="border-white/[.12] text-slate-100"><Bell size={16} />Não lida</Button><Button type="button" onClick={() => { onPin(actionMessage); setActionMessage(null); }} variant="outline" className="border-white/[.12] text-slate-100"><Pin size={16} />{actionMessage.pinnedAt ? "Desafixar" : "Fixar"}</Button>{actionMessage.attachment?.dataUrl && <Button type="button" onClick={() => { const anchor = document.createElement("a"); anchor.href = actionMessage.attachment!.dataUrl!; anchor.download = actionMessage.attachment!.name; anchor.click(); }} variant="outline" className="border-white/[.12] text-slate-100"><Download size={16} />Salvar</Button>}{canDelete(actionMessage) && <Button onClick={() => { onDelete(actionMessage); setActionMessage(null); }} className="bg-rose-500 text-white hover:bg-rose-400"><Trash2 size={16} />Excluir</Button>}</div></div>}<div ref={end} /></div>;
}

function AttachmentView({ attachment }: { attachment: LocalAttachment }) {
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState(1);
  if (!attachment.dataUrl) return <div className="mt-2 flex max-w-sm items-center gap-3 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-xs text-amber-100"><FileIcon size={17} /><span><strong>{attachment.name}</strong><br />Este anexo não está disponível neste momento.</span></div>;
  const isImage = attachment.mimeType.startsWith("image/");
  const isVideo = attachment.mimeType.startsWith("video/");
  if (attachment.mimeType.startsWith("audio/") && attachment.recordedInApp) return <div className="mt-2 flex max-w-sm items-center gap-3 rounded-xl border border-white/[.08] bg-white/[.04] p-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-violet-500/20 text-violet-300"><Mic size={18} /></span><audio controls src={attachment.dataUrl} className="h-9 min-w-0 flex-1" /></div>;
  const open = () => { setZoom(1); setExpanded(true); };
  const viewer = expanded && <div className="fixed inset-0 z-[70] flex flex-col bg-black/95 p-4" role="dialog" aria-label={`Visualizar ${attachment.name}`}><header className="flex items-center justify-between gap-3"><p className="min-w-0 truncate text-sm font-semibold text-white">{attachment.name}</p><div className="flex items-center gap-2">{isImage && <Button type="button" onClick={() => setZoom(value => value >= 2.5 ? 1 : value + 0.5)} variant="outline" className="border-white/20 text-white"><Maximize2 size={16} />{Math.round(zoom * 100)}%</Button>}<a href={attachment.dataUrl} download={attachment.name} className="grid h-9 w-9 place-items-center rounded-lg text-slate-200 hover:bg-white/10" aria-label="Baixar"><Download size={18} /></a><IconButton label="Fechar visualização" onClick={() => setExpanded(false)}><X size={19} /></IconButton></div></header><div className="mt-4 flex min-h-0 flex-1 items-center justify-center overflow-auto">{isImage ? <img src={attachment.dataUrl} alt={attachment.name} onClick={() => setZoom(value => value >= 2.5 ? 1 : value + 0.5)} className="max-h-full max-w-full cursor-zoom-in rounded-xl object-contain transition-transform duration-200" style={{ transform: `scale(${zoom})` }} /> : <video controls autoPlay src={attachment.dataUrl} className="max-h-full max-w-full rounded-xl" />}</div></div>;
  if (isImage) return <><button type="button" onClick={open} className="mt-2 block max-w-md overflow-hidden rounded-xl border border-white/[.08] text-left"><img src={attachment.dataUrl} alt={attachment.name} className="max-h-80 w-full object-cover" /><span className="flex items-center gap-2 px-3 py-2 text-xs text-slate-400"><Maximize2 size={14} />{attachment.name}</span></button>{viewer}</>;
  if (attachment.mimeType.startsWith("audio/")) return <div className="mt-2 flex max-w-sm items-center gap-3 rounded-xl border border-white/[.08] bg-white/[.04] p-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-violet-500/20 text-violet-300"><Mic size={18} /></span><audio controls src={attachment.dataUrl} className="h-9 min-w-0 flex-1" /><a href={attachment.dataUrl} download={attachment.name} className="text-[10px] font-semibold text-violet-300">Baixar</a></div>;
  if (isVideo) return <><button type="button" onClick={open} className="mt-2 max-w-lg overflow-hidden rounded-xl border border-white/[.08] bg-white/[.04] text-left"><video muted preload="metadata" src={attachment.dataUrl} className="max-h-80 w-full" /><div className="flex items-center gap-2 px-3 py-2 text-xs text-slate-400"><Maximize2 size={14} /><span className="truncate">{attachment.name}</span></div></button>{viewer}</>;
  return <a href={attachment.dataUrl} download={attachment.name} className="mt-2 flex max-w-sm items-center gap-3 rounded-xl border border-white/[.08] bg-white/[.04] p-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-violet-500/20 text-violet-300"><FileIcon size={18} /></span><span className="min-w-0"><span className="block truncate text-xs font-bold">{attachment.name}</span><span className="text-[10px] text-slate-500">{attachment.size ? `${Math.ceil(attachment.size / 1024)} KB` : "GIF"} · Baixar</span></span></a>;
}

function LegacyComposer({ value, onChange, attachment, replyTo, editingMessage, onCancelReply, onCancelEdit, onRemoveAttachment, onAttach, onPickGif, onInsertEmoji, onSend, room }: { value: string; onChange: (value: string) => void; attachment: LocalAttachment | null; replyTo: LocalMessage | null; editingMessage: LocalMessage | null; onCancelReply: () => void; onCancelEdit: () => void; onRemoveAttachment: () => void; onAttach: (file?: File) => void; onPickGif: (attachment: LocalAttachment) => void; onInsertEmoji: (emoji: string) => void; onSend: () => void; room: string }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const [recording, setRecording] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const toggleRecording = async () => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported("audio/webm") ? { mimeType: "audio/webm" } : undefined);
      recorderStreamRef.current = stream;
      chunksRef.current = [];
      recorder.ondataavailable = event => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        recorderStreamRef.current?.getTracks().forEach(track => track.stop());
        recorderStreamRef.current = null;
        recorderRef.current = null;
        setRecording(false);
        if (blob.size) onAttach(new File([blob], `audio-${Date.now()}.webm`, { type: blob.type }));
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      toast.error("Permita o acesso ao microfone para gravar uma mensagem de áudio.");
    }
  };
  useEffect(() => () => { recorderRef.current?.state === "recording" && recorderRef.current.stop(); recorderStreamRef.current?.getTracks().forEach(track => track.stop()); }, []);
	  return <div className="shrink-0 px-2 pb-2 pt-1 sm:px-5 sm:pb-4 sm:pt-2"><div className="rounded-2xl bg-[#11131d] p-1.5 sm:p-2"><input ref={fileInput} type="file" accept="image/*,video/*,audio/*,.gif" className="hidden" onChange={event => { onAttach(event.target.files?.[0]); event.currentTarget.value = ""; }} />{editingMessage && <div className="mb-1.5 flex items-center gap-2 border-l-2 border-emerald-400 bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-100"><Pencil size={14} className="text-emerald-300" /><span className="min-w-0 flex-1 truncate">Editando mensagem</span><button type="button" onClick={onCancelEdit} aria-label="Cancelar edição"><X size={14} /></button></div>}{replyTo && !editingMessage && <div className="mb-1.5 flex items-center gap-2 border-l-2 border-violet-400 bg-violet-500/10 px-2.5 py-1.5 text-xs text-violet-100"><CornerUpLeft size={14} className="text-violet-300" /><span className="min-w-0 flex-1 truncate">Respondendo a <strong>{replyTo.author.displayName}</strong>: {replyTo.body || replyTo.attachment?.name || "Mensagem"}</span><button type="button" onClick={onCancelReply} aria-label="Cancelar resposta"><X size={14} /></button></div>}{attachment && <div className="mb-1.5 flex max-w-max items-center gap-2 rounded-lg bg-violet-500/15 px-2.5 py-1.5 text-xs text-violet-200 sm:mb-2"><Paperclip size={13} /><span className="max-w-52 truncate">{attachment.name}</span><button onClick={onRemoveAttachment}><X size={14} /></button></div>}<div className="flex items-end gap-1.5 sm:gap-2"><IconButton label="Anexar imagem, vídeo ou arquivo" onClick={() => fileInput.current?.click()} disabled={recording} className="h-8 w-8 sm:h-9 sm:w-9"><Paperclip size={17} /></IconButton><IconButton label="Abrir emojis, GIFs e figurinhas" onClick={() => setShowGifPicker(true)} disabled={recording} className="h-8 w-8 sm:h-9 sm:w-9"><Smile size={17} /></IconButton><IconButton label={recording ? "Parar gravação" : "Gravar mensagem de áudio"} onClick={() => void toggleRecording()} active={recording} disabled={Boolean(attachment) && !recording} className="h-8 w-8 sm:h-9 sm:w-9">{recording ? <MicOff size={17} /> : <Mic size={17} />}</IconButton><Textarea value={value} onChange={event => onChange(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSend(); } }} placeholder={recording ? "Gravando mensagem de áudio…" : editingMessage ? "Editar mensagem" : `Enviar mensagem para #${room}`} disabled={recording} className="min-h-9 max-h-28 flex-1 resize-none border-0 bg-transparent py-1.5 text-sm text-white shadow-none focus-visible:ring-0 sm:min-h-10 sm:max-h-32 sm:py-2" rows={1} /><Button onClick={onSend} disabled={recording || (!value.trim() && !attachment)} className="h-8 w-8 rounded-lg bg-violet-500 p-0 hover:bg-violet-400 sm:h-9 sm:w-auto sm:rounded-xl sm:px-3"><SendHorizontal size={16} /></Button></div></div><p className={`mt-1 px-2 text-[10px] text-slate-600 sm:mt-2 ${recording ? "block" : "hidden sm:block"}`}>{recording ? "Gravando — toque no microfone para finalizar" : editingMessage ? "Enter salva a edição" : "Enter envia · anexos locais até 15 MB · anexos do servidor são removidos em até 3 dias"}</p>{showGifPicker && <GifPicker onSelect={onPickGif} onEmoji={onInsertEmoji} onClose={() => setShowGifPicker(false)} />}</div>;
}

function Composer({ value, onChange, attachment, replyTo, editingMessage, onCancelReply, onCancelEdit, onRemoveAttachment, onAttach, onSendMedia, onInsertEmoji, onSend, room }: { value: string; onChange: (value: string) => void; attachment: LocalAttachment | null; replyTo: LocalMessage | null; editingMessage: LocalMessage | null; onCancelReply: () => void; onCancelEdit: () => void; onRemoveAttachment: () => void; onAttach: (file?: File) => void; onSendMedia: (attachment: LocalAttachment) => void; onInsertEmoji: (emoji: string) => void; onSend: () => void; room: string }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const holdTimerRef = useRef<number | null>(null);
  const pressingRef = useRef(false);
  const pressStartedAtRef = useRef(0);
  const pressOriginXRef = useRef(0);
  const shouldSendRef = useRef(false);
  const [preparingRecording, setPreparingRecording] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const desktopAudioControls = typeof navigator !== "undefined" && !/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

  const clearHoldTimer = () => {
    if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
  };

  const releaseStream = () => {
    recorderStreamRef.current?.getTracks().forEach(track => track.stop());
    recorderStreamRef.current = null;
  };

  const beginRecorder = async () => {
    if (!pressingRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (!pressingRef.current) { stream.getTracks().forEach(track => track.stop()); return; }
      const recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported("audio/webm") ? { mimeType: "audio/webm" } : undefined);
      recorderStreamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = event => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const sendAudio = shouldSendRef.current && blob.size > 0;
        releaseStream();
        recorderRef.current = null;
        setRecording(false);
        setPreparingRecording(false);
        if (!sendAudio) {
          toast.error("Grave por pelo menos 1 segundo para enviar o áudio.");
          return;
        }
        void (async () => {
          try {
            const file = new File([blob], `audio-${Date.now()}.webm`, { type: blob.type });
            onSendMedia({ ...(await fileAsAttachment(file)), recordedInApp: true });
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Não foi possível preparar o áudio.");
          }
        })();
      };
      recorder.start();
      setPreparingRecording(false);
      setRecording(true);
    } catch {
      setPreparingRecording(false);
      pressingRef.current = false;
      toast.error("Permita o acesso ao microfone para gravar uma mensagem de áudio.");
    }
  };

  const beginPressRecording = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || attachment || editingMessage || pressingRef.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pressingRef.current = true;
    shouldSendRef.current = false;
    pressStartedAtRef.current = Date.now();
    pressOriginXRef.current = event.clientX;
    setPreparingRecording(true);
    holdTimerRef.current = window.setTimeout(() => { void beginRecorder(); }, AUDIO_PRE_RECORD_DELAY_MS);
  };

  const beginDesktopRecording = () => {
    if (attachment || editingMessage || pressingRef.current) return;
    pressingRef.current = true;
    shouldSendRef.current = false;
    pressStartedAtRef.current = Date.now();
    setPreparingRecording(true);
    void beginRecorder();
  };

  const finishPressRecording = (cancelled = false) => {
    if (!pressingRef.current) return;
    pressingRef.current = false;
    clearHoldTimer();
    shouldSendRef.current = shouldSendHeldAudio(pressStartedAtRef.current, Date.now(), cancelled);
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    else {
      setPreparingRecording(false);
      if (!cancelled) toast.error("Grave por pelo menos 1 segundo para enviar o áudio.");
    }
  };

  const cancelRecording = () => finishPressRecording(true);

  useEffect(() => {
    if (!recording) { setRecordingElapsedMs(0); return; }
    const update = () => setRecordingElapsedMs(Date.now() - pressStartedAtRef.current);
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => () => {
    clearHoldTimer();
    pressingRef.current = false;
    shouldSendRef.current = false;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    releaseStream();
  }, []);

  const isCapturing = preparingRecording || recording;
  const composerHint = recording
    ? desktopAudioControls ? "Use o painel acima para enviar ou cancelar o áudio" : "Solte para enviar · deslize para a esquerda para cancelar"
    : preparingRecording
      ? "Continue segurando para iniciar a gravação"
      : editingMessage
        ? "Enter salva a edição"
        : "Enter envia · arquivos da galeria seguem a política de retenção";

  const duration = `${String(Math.floor(recordingElapsedMs / 60_000)).padStart(2, "0")}:${String(Math.floor(recordingElapsedMs / 1_000) % 60).padStart(2, "0")}`;
  return <div className="shrink-0 px-2 pb-2 pt-1 sm:px-5 sm:pb-4 sm:pt-2">{recording && desktopAudioControls && <div className="mb-2 hidden items-center gap-3 rounded-2xl border border-rose-400/25 bg-[#21181d] px-3 py-2.5 text-sm sm:flex"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-400" /><span className="font-mono font-bold text-rose-100">{duration}</span><span className="min-w-0 flex-1 text-xs text-slate-300">Gravando mensagem de áudio</span><IconButton label="Cancelar gravação" onClick={cancelRecording} className="h-8 w-8 text-rose-200 hover:bg-rose-500/20"><Trash2 size={16} /></IconButton><Button type="button" onClick={() => finishPressRecording(false)} className="h-8 rounded-lg bg-emerald-500 px-3 text-xs hover:bg-emerald-400"><SendHorizontal size={15} />Enviar</Button></div>}<div className="rounded-2xl bg-[#11131d] p-1.5 sm:p-2"><input ref={fileInput} type="file" accept="image/*,video/*,audio/*,.gif" className="hidden" onChange={event => { onAttach(event.target.files?.[0]); event.currentTarget.value = ""; }} />{editingMessage && <div className="mb-1.5 flex items-center gap-2 border-l-2 border-emerald-400 bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-100"><Pencil size={14} className="text-emerald-300" /><span className="min-w-0 flex-1 truncate">Editando mensagem</span><button type="button" onClick={onCancelEdit} aria-label="Cancelar edição"><X size={14} /></button></div>}{replyTo && !editingMessage && <div className="mb-1.5 flex items-center gap-2 border-l-2 border-violet-400 bg-violet-500/10 px-2.5 py-1.5 text-xs text-violet-100"><CornerUpLeft size={14} className="text-violet-300" /><span className="min-w-0 flex-1 truncate">Respondendo a <strong>{replyTo.author.displayName}</strong>: {replyTo.body || replyTo.attachment?.name || "Mensagem"}</span><button type="button" onClick={onCancelReply} aria-label="Cancelar resposta"><X size={14} /></button></div>}{attachment && <div className="mb-1.5 flex max-w-max items-center gap-2 rounded-lg bg-violet-500/15 px-2.5 py-1.5 text-xs text-violet-200 sm:mb-2"><Paperclip size={13} /><span className="max-w-52 truncate">{attachment.name}</span><button type="button" onClick={onRemoveAttachment}><X size={14} /></button></div>}<div className="flex items-end gap-1.5 sm:gap-2"><IconButton label="Anexar arquivo da galeria" onClick={() => fileInput.current?.click()} disabled={isCapturing} className="h-8 w-8 sm:h-9 sm:w-9"><Paperclip size={17} /></IconButton><IconButton label="Abrir emojis, GIFs e figurinhas" onClick={() => setShowGifPicker(true)} disabled={isCapturing} className="h-8 w-8 sm:h-9 sm:w-9"><Smile size={17} /></IconButton><button type="button" aria-label={recording ? "Gravação em andamento" : desktopAudioControls ? "Gravar mensagem de áudio" : "Segure para gravar uma mensagem de áudio"} title={desktopAudioControls ? "Gravar áudio" : "Segure por 1 segundo para gravar"} disabled={Boolean(attachment) || Boolean(editingMessage) || isCapturing} onClick={desktopAudioControls ? beginDesktopRecording : undefined} onPointerDown={desktopAudioControls ? undefined : beginPressRecording} onPointerUp={desktopAudioControls ? undefined : () => finishPressRecording()} onPointerCancel={desktopAudioControls ? undefined : () => finishPressRecording(true)} onPointerMove={desktopAudioControls ? undefined : event => { if (pressingRef.current && event.clientX - pressOriginXRef.current <= -72) finishPressRecording(true); }} onContextMenu={event => event.preventDefault()} className={`grid h-8 w-8 place-items-center rounded-lg transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 sm:h-9 sm:w-9 ${recording ? "animate-pulse bg-rose-500 text-white" : preparingRecording ? "bg-amber-400 text-slate-950" : "text-slate-400 hover:bg-white/[.07] hover:text-white"}`}><Mic size={17} /></button><Textarea value={value} onChange={event => onChange(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSend(); } }} placeholder={isCapturing ? (recording ? "Gravando mensagem de áudio…" : "Segure o microfone…") : editingMessage ? "Editar mensagem" : `Enviar mensagem para #${room}`} disabled={isCapturing} className="min-h-9 max-h-28 flex-1 resize-none border-0 bg-transparent py-1.5 text-sm text-white shadow-none focus-visible:ring-0 sm:min-h-10 sm:max-h-32 sm:py-2" rows={1} /><Button onClick={onSend} disabled={isCapturing || (!value.trim() && !attachment)} className="h-8 w-8 rounded-lg bg-violet-500 p-0 hover:bg-violet-400 sm:h-9 sm:w-auto sm:rounded-xl sm:px-3"><SendHorizontal size={16} /></Button></div></div><p className={`mt-1 px-2 text-[10px] sm:mt-2 ${isCapturing ? "text-rose-200" : "text-slate-600"}`}>{composerHint}</p>{showGifPicker && <GifPicker onSelect={onSendMedia} onEmoji={onInsertEmoji} onClose={() => setShowGifPicker(false)} />}</div>;
}

function CallView({ call, title, currentProfile }: { call: ReturnType<typeof useCall>; title: string; currentProfile: LocalProfile }) {
  const isMobile = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const [focusedTile, setFocusedTile] = useState<string | null>(null);
  const localTileId = "local";
  const focusedRemote = call.remotePeers.find(peer => peer.socketId === focusedTile);
  const focusedVideo = focusedTile === localTileId && call.localStream ? { stream: call.localStream, name: call.sharingScreen ? "Seu compartilhamento de tela" : "Você", muted: true, mirrored: !call.sharingScreen, screenShare: call.sharingScreen } : focusedRemote ? { stream: focusedRemote.stream, name: focusedRemote.profile.displayName, muted: false, mirrored: false, screenShare: focusedRemote.sharingScreen } : null;
  const hasScreenShare = call.sharingScreen || call.remotePeers.some(peer => peer.sharingScreen);
  useEffect(() => { if (focusedTile && !focusedVideo) setFocusedTile(null); }, [focusedTile, focusedVideo]);
  return <div className="fixed inset-0 z-50 flex flex-col bg-[#0b0d14]">
    <header className="flex h-16 items-center justify-between border-b border-white/[.07] px-4">
      <div className="min-w-0"><p className="text-[11px] font-bold uppercase tracking-[.14em] text-violet-300">{call.outgoingCall && !call.remotePeers.length ? "Chamando…" : "Chamada ao vivo"}</p><p className="truncate text-sm font-semibold">{title}</p></div>
	      <div className="flex items-center gap-2 sm:gap-3"><CallPresenceBadge call={call} currentProfile={currentProfile} />{hasScreenShare && <span className="hidden items-center gap-1.5 rounded-lg bg-rose-500 px-2 py-1 text-[10px] font-black tracking-[.12em] text-white sm:inline-flex"><i className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />LIVE</span>}<p className="hidden text-xs text-slate-500 xl:block">Toque em um vídeo para ampliar</p>{isNativeRuntime() && <IconButton label="Minimizar chamada" onClick={() => void call.minimizeCall()}><Minimize2 size={19} /></IconButton>}<Button onClick={call.endCall} className="rounded-xl bg-rose-500 px-3 hover:bg-rose-400 sm:px-4"><Phone size={17} className="rotate-[135deg]" /><span className="hidden sm:inline">Encerrar</span></Button></div>
    </header>
    <div className="grid min-h-0 flex-1 auto-rows-fr gap-3 overflow-y-auto p-4 sm:grid-cols-2 lg:grid-cols-3">{call.localStream && <VideoTile stream={call.localStream} name={call.sharingScreen ? "Seu compartilhamento de tela" : "Você"} muted mirrored={!call.sharingScreen} screenShare={call.sharingScreen} onFocus={() => setFocusedTile(localTileId)} />}{call.remotePeers.map(peer => <VideoTile key={peer.socketId} stream={peer.stream} name={peer.profile.displayName} screenShare={peer.sharingScreen} onFocus={() => setFocusedTile(peer.socketId)} />)}{call.outgoingCall && !call.remotePeers.length && <div className="grid min-h-[160px] place-items-center rounded-2xl bg-[#10121a] text-center"><div><Loader2 className="mx-auto animate-spin text-violet-300" size={26} /><p className="mt-3 text-sm font-semibold">Aguardando alguém atender</p><p className="mt-1 text-xs text-slate-500">O toque foi enviado para as pessoas online.</p></div></div>}</div>
	    <footer className="flex items-center justify-center gap-2 border-t border-white/[.07] bg-[#11131d] p-4"><IconButton label={call.muted ? "Ativar microfone" : "Silenciar microfone"} active={call.muted} onClick={call.toggleMute}>{call.muted ? <MicOff size={19} /> : <Mic size={19} />}</IconButton><IconButton label={call.cameraOff ? "Ativar câmera" : "Desativar câmera"} active={call.cameraOff} onClick={() => void call.toggleCamera()} disabled={call.sharingScreen || call.switchingCamera}>{call.cameraOff ? <VideoOff size={19} /> : <Video size={19} />}</IconButton>{!call.cameraOff && <div className="relative"><IconButton label={call.switchingCamera ? "Trocando câmera" : isMobile ? `Trocar para câmera ${call.cameraFacing === "user" ? "traseira" : "frontal"}` : "Trocar câmera"} onClick={() => void call.switchCamera()} disabled={call.sharingScreen || call.switchingCamera}>{call.switchingCamera ? <Loader2 size={19} className="animate-spin" /> : <SwitchCamera size={19} />}</IconButton>{isMobile && <span className="absolute -bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] font-bold text-slate-500">{call.switchingCamera ? "Trocando…" : call.cameraFacing === "user" ? "Frontal" : "Traseira"}</span>}</div>}{(!isMobile || isNativeRuntime()) && <IconButton label={call.sharingScreen ? "Parar compartilhamento" : "Compartilhar tela"} active={call.sharingScreen} onClick={() => void (call.sharingScreen ? call.stopSharing() : call.shareScreen())}><MonitorUp size={19} /></IconButton>}<IconButton label="Volume da chamada"><Volume2 size={19} /></IconButton></footer>
    {focusedVideo && <FullscreenVideo {...focusedVideo} onMinimize={() => setFocusedTile(null)} />}
  </div>;
}

function IncomingCallModal({ call }: { call: ReturnType<typeof useCall> }) {
  const invite = call.incomingCall;
  if (!invite) return null;
  return <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/75 p-4 backdrop-blur-sm"><div className="orbit-enter w-full max-w-sm rounded-[28px] border border-violet-400/25 bg-[#1d2030] p-7 text-center shadow-2xl"><div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-violet-500 text-white animate-pulse"><Phone size={27} /></div><p className="mt-5 text-xs font-bold uppercase tracking-[.16em] text-violet-300">Chamada recebida</p><h2 className="mt-2 text-xl font-bold">{invite.caller.displayName} está ligando</h2><p className="mt-2 text-sm text-slate-400">{invite.withVideo ? "Chamada de vídeo" : "Chamada de áudio"} · Toque para atender</p><div className="mt-7 flex justify-center gap-4"><Button onClick={call.declineIncomingCall} className="h-12 rounded-2xl bg-rose-500 px-5 hover:bg-rose-400"><Phone size={18} className="rotate-[135deg]" />Recusar</Button><Button onClick={() => void call.acceptIncomingCall()} className="h-12 rounded-2xl bg-emerald-500 px-5 hover:bg-emerald-400"><Phone size={18} />Atender</Button></div></div></div>;
}

function LegacyProfileModal({ profile, onClose, onSave, onManageAccounts }: { profile: LocalProfile; onClose: () => void; onSave: (profile: LocalProfile) => void; onManageAccounts: () => void }) {
  const [avatar, setAvatar] = useState(profile.avatarUrl);
  const [changingPassword, setChangingPassword] = useState(false);
  const copy = async () => { await navigator.clipboard.writeText(profile.connectionCode); toast.success("Código copiado."); };
  const changePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") || "");
    const confirmation = String(data.get("confirmation") || "");
    if (!isValidPassword(password)) return toast.error(passwordRuleMessage);
    if (!passwordsMatch(password, confirmation)) return toast.error("As duas senhas precisam ser iguais.");
    if (!profile.authToken) return toast.error("Entre novamente para trocar a senha.");
    const response = await fetch(runtimeApiUrl("/api/account/change-password"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken: profile.authToken, password }) });
    if (!response.ok) {
      const result = await response.json() as { message?: string };
      return toast.error(result.message || "Não foi possível trocar a senha.");
    }
    setChangingPassword(false);
    toast.success("Senha alterada.");
  };
  return <Modal onClose={onClose}><div className="flex items-start justify-between"><div><h2 className="text-lg font-bold">Seu perfil</h2><p className="mt-1 text-sm text-slate-400">{profile.accountType === "official" ? `Conta · @${profile.username || "usuario"}` : "Conta Guest · código para adicionar"}</p></div><IconButton label="Fechar" onClick={onClose}><X size={18} /></IconButton></div><form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); onSave({ ...profile, displayName: String(data.get("name") || "").trim(), bio: String(data.get("bio") || "").trim(), avatarUrl: avatar }); }}><div className="mt-5 flex items-center gap-4"><ProfileAvatar profile={{ displayName: profile.displayName, avatarUrl: avatar }} className="h-16 w-16" />{profile.accountType === "official" ? <label className="cursor-pointer rounded-lg bg-white/[.07] px-3 py-2 text-xs font-bold text-slate-300"><input type="file" accept="image/*" className="hidden" onChange={async event => { try { const file = event.target.files?.[0]; if (file) setAvatar((await fileAsAttachment(file)).dataUrl); } catch (error) { toast.error(error instanceof Error ? error.message : "Imagem inválida."); } }} />Trocar foto</label> : <span className="text-xs text-slate-500">Foto bloqueada para Guest</span>}</div><label className="mt-5 block text-xs font-bold uppercase tracking-[.12em] text-slate-400">Display name<Input name="name" required disabled={profile.accountType === "guest"} defaultValue={profile.displayName} className="mt-2 h-11 border-white/[.09] bg-[#11131d] text-white disabled:cursor-not-allowed disabled:opacity-50" /></label><label className="mt-4 block text-xs font-bold uppercase tracking-[.12em] text-slate-400">Descrição<Textarea name="bio" defaultValue={profile.bio} className="mt-2 min-h-20 border-white/[.09] bg-[#11131d] text-white" /></label><div className="mt-4 rounded-xl bg-violet-500/10 p-3"><p className="text-[10px] font-bold uppercase tracking-[.13em] text-violet-300">Seu código de conexão</p><button type="button" onClick={() => void copy()} className="mt-1 flex items-center gap-2 font-mono text-lg font-bold tracking-[.16em]">{profile.connectionCode}<Copy size={14} /></button></div><Button type="button" variant="outline" onClick={onManageAccounts} className="mt-3 h-10 w-full border-violet-400/30 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20 hover:text-white">Gerenciar contas</Button>{profile.accountType === "official" && <Button type="button" variant="outline" onClick={() => setChangingPassword(true)} className="mt-3 h-10 w-full border-white/[.12] bg-white/[.04] text-slate-200 hover:bg-white/[.08] hover:text-white">Alterar senha</Button>}<Button className="mt-3 h-11 w-full rounded-xl bg-violet-500 hover:bg-violet-400"><Check size={17} />Salvar perfil</Button></form>{changingPassword && profile.accountType === "official" && <form className="mt-5 rounded-2xl border border-violet-400/25 bg-violet-500/5 p-4" onSubmit={event => void changePassword(event)}><p className="text-sm font-bold text-white">Alterar senha</p><p className="mt-1 text-xs text-slate-400">Sua senha atual não é guardada neste dispositivo.</p><Input name="password" type="password" required minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} pattern={PASSWORD_HTML_PATTERN} title={passwordRuleMessage} autoComplete="new-password" className="mt-3 h-11 border-white/[.09] bg-[#11131d] text-white" placeholder="Nova senha" /><Input name="confirmation" type="password" required minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} autoComplete="new-password" className="mt-2 h-11 border-white/[.09] bg-[#11131d] text-white" placeholder="Repita a nova senha" /><div className="mt-3 grid grid-cols-2 gap-2"><Button type="button" variant="outline" onClick={() => setChangingPassword(false)} className="border-white/[.1] bg-white/[.03] text-slate-300">Cancelar</Button><Button className="bg-violet-500">Confirmar senha</Button></div></form>}</Modal>;
}

function ProfileModal({ profile, onClose, onSave, onManageAccounts }: { profile: LocalProfile; onClose: () => void; onSave: (profile: LocalProfile) => void; onManageAccounts: () => void }) {
  const [avatar, setAvatar] = useState(profile.avatarUrl);
  const [changingPassword, setChangingPassword] = useState(false);
  const copy = async () => { await navigator.clipboard.writeText(profile.connectionCode); toast.success("Código copiado."); };
  const changePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") || "");
    const confirmation = String(data.get("confirmation") || "");
    if (!isValidPassword(password)) return toast.error(passwordRuleMessage);
    if (!passwordsMatch(password, confirmation)) return toast.error("As duas senhas precisam ser iguais.");
    if (!profile.authToken) return toast.error("Entre novamente para trocar a senha.");
    try {
      const response = await fetch(runtimeApiUrl("/api/account/change-password"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken: profile.authToken, password }) });
      if (!response.ok) {
        const result = await response.json() as { message?: string };
        return toast.error(result.message || "Não foi possível trocar a senha.");
      }
      setChangingPassword(false);
      toast.success("Senha alterada.");
    } catch {
      toast.error("Não foi possível trocar a senha agora.");
    }
  };

  return <><Modal onClose={onClose}><div className="flex items-start justify-between"><div><h2 className="text-lg font-bold">Seu perfil</h2><p className="mt-1 text-sm text-slate-400">{profile.accountType === "official" ? `Conta · @${profile.username || "usuario"}` : "Conta Guest · código para adicionar"}</p></div><IconButton label="Fechar" onClick={onClose}><X size={18} /></IconButton></div><form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); onSave({ ...profile, displayName: String(data.get("name") || "").trim(), bio: String(data.get("bio") || "").trim(), avatarUrl: avatar }); }}><div className="mt-5 flex items-center gap-4"><ProfileAvatar profile={{ displayName: profile.displayName, avatarUrl: avatar }} className="h-16 w-16" />{profile.accountType === "official" ? <label className="cursor-pointer rounded-lg bg-white/[.07] px-3 py-2 text-xs font-bold text-slate-300"><input type="file" accept="image/*" className="hidden" onChange={async event => { try { const file = event.target.files?.[0]; if (file) setAvatar((await fileAsAttachment(file)).dataUrl); } catch (error) { toast.error(error instanceof Error ? error.message : "Imagem inválida."); } }} />Trocar foto</label> : <span className="text-xs text-slate-500">Foto bloqueada para Guest</span>}</div><label className="mt-5 block text-xs font-bold uppercase tracking-[.12em] text-slate-400">Display name<Input name="name" required disabled={profile.accountType === "guest"} defaultValue={profile.displayName} className="mt-2 h-11 border-white/[.09] bg-[#11131d] text-white disabled:cursor-not-allowed disabled:opacity-50" /></label><label className="mt-4 block text-xs font-bold uppercase tracking-[.12em] text-slate-400">Descrição<Textarea name="bio" defaultValue={profile.bio} className="mt-2 min-h-20 border-white/[.09] bg-[#11131d] text-white" /></label><div className="mt-4 rounded-xl bg-violet-500/10 p-3"><p className="text-[10px] font-bold uppercase tracking-[.13em] text-violet-300">Seu código de conexão</p><button type="button" onClick={() => void copy()} className="mt-1 flex items-center gap-2 font-mono text-lg font-bold tracking-[.16em]">{profile.connectionCode}<Copy size={14} /></button></div><Button type="button" variant="outline" onClick={onManageAccounts} className="mt-3 h-10 w-full border-violet-400/30 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20 hover:text-white">Gerenciar contas</Button>{profile.accountType === "official" && <Button type="button" variant="outline" onClick={() => setChangingPassword(true)} className="mt-3 h-10 w-full border-white/[.12] bg-white/[.04] text-slate-200 hover:bg-white/[.08] hover:text-white">Alterar senha</Button>}<Button className="mt-3 h-11 w-full rounded-xl bg-violet-500 hover:bg-violet-400"><Check size={17} />Salvar perfil</Button></form></Modal>{changingPassword && profile.accountType === "official" && <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm" onMouseDown={() => setChangingPassword(false)}><form className="orbit-enter w-full max-w-sm rounded-3xl border border-violet-400/25 bg-[#1d2030] p-6 shadow-2xl" onMouseDown={event => event.stopPropagation()} onSubmit={event => void changePassword(event)}><div className="flex items-start justify-between gap-4"><div><h3 className="text-lg font-bold text-white">Alterar senha</h3><p className="mt-1 text-xs leading-5 text-slate-400">Sua senha atual não é guardada neste dispositivo.</p></div><IconButton label="Cancelar alteração de senha" onClick={() => setChangingPassword(false)} className="h-8 w-8"><X size={17} /></IconButton></div><label className="mt-5 block text-xs font-bold uppercase tracking-[.12em] text-slate-400">Nova senha<Input name="password" type="password" required minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} pattern={PASSWORD_HTML_PATTERN} title={passwordRuleMessage} autoComplete="new-password" autoFocus className="mt-2 h-11 border-white/[.09] bg-[#11131d] text-white" placeholder="Nova senha" /></label><label className="mt-4 block text-xs font-bold uppercase tracking-[.12em] text-slate-400">Confirmação<Input name="confirmation" type="password" required minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} autoComplete="new-password" className="mt-2 h-11 border-white/[.09] bg-[#11131d] text-white" placeholder="Repita a nova senha" /></label><div className="mt-5 grid grid-cols-2 gap-2"><Button type="button" variant="outline" onClick={() => setChangingPassword(false)} className="border-white/[.1] bg-white/[.03] text-slate-300">Cancelar</Button><Button className="bg-violet-500 hover:bg-violet-400">Confirmar senha</Button></div></form></div>}</>;
}

function ServerMemberManagerModal({ member, serverProfile, canChangeRole, onClose, onSave, onRemove }: { member: LocalProfile; serverProfile?: { displayName?: string; tag?: string; tagColor?: string; role?: "owner" | "admin" | "member" }; canChangeRole: boolean; onClose: () => void; onSave: (values: { role: "admin" | "member"; displayName: string; tag: string; tagColor: string }) => void; onRemove?: () => void }) {
  const [displayName, setDisplayName] = useState(serverProfile?.displayName || member.displayName);
  const [tag, setTag] = useState(serverProfile?.tag || "");
  const [tagColor, setTagColor] = useState(serverProfile?.tagColor || "#8b5cf6");
  const [role, setRole] = useState<"admin" | "member">(serverProfile?.role === "admin" ? "admin" : "member");
  return <Modal onClose={onClose}><div className="flex items-start justify-between"><div><h2 className="text-lg font-bold">Perfil no servidor</h2><p className="mt-1 text-sm text-slate-400">{member.displayName}</p></div><IconButton label="Fechar" onClick={onClose}><X size={18} /></IconButton></div><form onSubmit={event => { event.preventDefault(); onSave({ displayName: displayName.trim().slice(0, 32), tag: tag.trim().slice(0, 16), tagColor: /^#[0-9a-f]{6}$/i.test(tagColor) ? tagColor : "#8b5cf6", role }); }}><label className="mt-5 block text-xs font-bold uppercase tracking-[.12em] text-slate-400">Display name exclusivo<Input value={displayName} onChange={event => setDisplayName(event.target.value)} className="mt-2 h-10 border-white/[.09] bg-[#11131d] text-white" /></label><label className="mt-4 block text-xs font-bold uppercase tracking-[.12em] text-slate-400">Tag<label className="mt-2 flex items-center gap-2"><Input value={tag} onChange={event => setTag(event.target.value)} className="h-10 border-white/[.09] bg-[#11131d] text-white" placeholder="Ex.: Moderador" /><Input type="color" value={tagColor} onChange={event => setTagColor(event.target.value)} className="h-10 w-14 border-white/[.09] bg-[#11131d] p-1" /></label></label>{canChangeRole && <label className="mt-4 block text-xs font-bold uppercase tracking-[.12em] text-slate-400">Papel<select value={role} onChange={event => setRole(event.target.value as "admin" | "member")} className="mt-2 h-10 w-full rounded-lg border border-white/[.09] bg-[#11131d] px-3 text-white"><option value="member">Membro</option><option value="admin">Administrador</option></select></label>}<Button className="mt-5 h-11 w-full rounded-xl bg-violet-500 hover:bg-violet-400"><Check size={17} />Salvar perfil do servidor</Button></form>{onRemove && <Button type="button" onClick={onRemove} variant="outline" className="mt-3 h-10 w-full border-rose-400/30 text-rose-200 hover:bg-rose-500/15 hover:text-rose-100"><Trash2 size={16} />Remover do servidor e excluir mensagens</Button>}</Modal>;
}

function ProfileViewer({ profile, serverProfile, ownId, onClose, onMessage }: { profile: LocalProfile; serverProfile?: { displayName?: string; tag?: string; tagColor?: string; role?: "owner" | "admin" | "member" }; ownId: string; onClose: () => void; onMessage: () => void }) {
  const copy = async () => { await navigator.clipboard.writeText(profile.connectionCode); toast.success("Código de conexão copiado."); };
  return <Modal onClose={onClose}><div className="flex items-start justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[.15em] text-violet-300">Perfil</p><h2 className="mt-1 text-xl font-bold">{serverProfile?.displayName || profile.displayName}</h2>{serverProfile?.tag && <p style={{ color: serverProfile.tagColor || "#a78bfa" }} className="mt-1 text-xs font-bold">{serverProfile.tag} · {serverProfile.role === "owner" ? "Proprietário" : serverProfile.role === "admin" ? "Administrador" : "Membro"}</p>}</div><IconButton label="Fechar" onClick={onClose}><X size={18} /></IconButton></div><div className="mt-6 flex items-center gap-4"><ProfileAvatar profile={profile} className="h-20 w-20 rounded-3xl" /><div className="min-w-0"><p className="text-sm font-medium text-slate-300">{profile.bio || "Esta pessoa ainda não escreveu uma descrição."}</p><button type="button" onClick={() => void copy()} className="mt-3 flex items-center gap-2 rounded-lg bg-violet-500/10 px-3 py-2 font-mono text-sm font-bold tracking-[.13em] text-violet-200 hover:bg-violet-500/20">{profile.connectionCode}<Copy size={14} /></button></div></div>{profile.id !== ownId && <Button onClick={onMessage} className="mt-6 h-11 w-full rounded-xl bg-violet-500 hover:bg-violet-400"><SendHorizontal size={17} />Enviar mensagem</Button>}</Modal>;
}

function ContactModal({ accountType, onClose, onAdd, onAddUsername }: { accountType: "official" | "guest"; onClose: () => void; onAdd: (code: string) => void; onAddUsername: (username: string) => void }) {
  const [mode, setMode] = useState<"code" | "username">("code");
  return <Modal onClose={onClose}><h2 className="text-lg font-bold">Adicionar contato</h2><p className="mt-1 text-sm text-slate-400">Use o código ou o nome de usuário da pessoa.</p><div className="mt-4 flex gap-2"><button type="button" onClick={() => setMode("code")} className={`flex-1 rounded-lg px-3 py-2 text-xs font-bold ${mode === "code" ? "bg-violet-500 text-white" : "bg-white/[.05] text-slate-400"}`}>Código</button><button type="button" onClick={() => setMode("username")} className={`flex-1 rounded-lg px-3 py-2 text-xs font-bold ${mode === "username" ? "bg-violet-500 text-white" : "bg-white/[.05] text-slate-400"}`}>Nome de usuário</button></div><form onSubmit={event => { event.preventDefault(); const value = String(new FormData(event.currentTarget).get("value") || "").trim(); if (mode === "username") onAddUsername(value); else onAdd(value); }}><Input name="value" required maxLength={mode === "username" ? USERNAME_MAX_LENGTH : 6} className={`mt-4 h-12 border-white/[.09] bg-[#11131d] text-white ${mode !== "username" ? "font-mono uppercase tracking-[.2em]" : ""}`} placeholder={mode === "username" ? "nome_usuario" : "AB12CD"} /><Button className="mt-4 h-11 w-full rounded-xl bg-violet-500 hover:bg-violet-400"><UserPlus size={17} />Enviar solicitação</Button></form></Modal>;
}

function RequestsModal({ requests, onClose, onResolve }: { requests: LocalRequest[]; onClose: () => void; onResolve: (request: LocalRequest, accepted: boolean) => void }) {
  return <Modal onClose={onClose}><div className="flex items-start justify-between"><div><h2 className="text-lg font-bold">Notificações</h2><p className="mt-1 text-sm text-slate-400">Pedidos de amizade e convites aguardando sua resposta.</p></div><IconButton label="Fechar" onClick={onClose}><X size={18} /></IconButton></div><div className="mt-5 space-y-3">{requests.length ? requests.map(request => <article key={request.id} className="rounded-2xl border border-white/[.08] bg-[#11131d] p-3"><div className="flex items-center gap-3"><ProfileAvatar profile={request.from} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{request.from.displayName}</p><p className="text-xs text-slate-400">{request.kind === "contact" ? "Quer adicionar você aos contatos." : "Enviou um convite de grupo."}</p></div></div><div className="mt-3 grid grid-cols-2 gap-2"><Button variant="outline" onClick={() => onResolve(request, false)} className="h-9 border-white/[.1] bg-white/[.03] text-slate-300">Recusar</Button><Button onClick={() => onResolve(request, true)} className="h-9 bg-violet-500">Aceitar</Button></div></article>) : <p className="rounded-xl border border-dashed border-white/[.1] p-5 text-center text-sm text-slate-500">Nenhuma solicitação pendente.</p>}</div></Modal>;
}

function GroupModal({ initial, onClose, onCreate }: { initial?: LocalGroup; onClose: () => void; onCreate: (name: string, imageUrl: string | null) => void }) {
  const [name, setName] = useState(initial?.name || "");
  const [imageUrl, setImageUrl] = useState<string | null>(initial?.imageUrl || null);
  return <Modal onClose={onClose}><h2 className="text-lg font-bold">{initial ? "Editar servidor" : "Criar grupo"}</h2><p className="mt-1 text-sm text-slate-400">Escolha um nome e um ícone para identificar o servidor.</p><div className="mt-5 flex items-center gap-3"><div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-violet-500 text-lg font-black text-white">{imageUrl ? <img src={imageUrl} alt="Ícone do servidor" className="h-full w-full object-cover" /> : initials(name || "S")}</div><label className="flex-1 cursor-pointer rounded-xl border border-dashed border-white/[.15] p-3 text-center text-xs text-slate-400 hover:border-violet-400 hover:text-white"><ImagePlus className="mx-auto mb-1" size={18} />Escolher ícone<input type="file" accept="image/*" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 2 * 1024 * 1024) { toast.error("O ícone deve ter no máximo 2 MB."); return; } const reader = new FileReader(); reader.onload = () => setImageUrl(String(reader.result)); reader.readAsDataURL(file); }} /></label></div><form onSubmit={event => { event.preventDefault(); onCreate(name, imageUrl); }}><Input name="name" required minLength={2} value={name} onChange={event => setName(event.target.value)} className="mt-4 h-12 border-white/[.09] bg-[#11131d] text-white" placeholder="Nome do servidor" /><Button className="mt-4 h-11 w-full rounded-xl bg-violet-500 hover:bg-violet-400"><FolderPlus size={17} />{initial ? "Salvar servidor" : "Criar servidor"}</Button></form></Modal>;
}

function InviteModal({ contacts, memberIds, onClose, onInvite }: { contacts: LocalProfile[]; memberIds: string[]; onClose: () => void; onInvite: (contacts: LocalProfile[], typedCode: string) => void }) {
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(() => new Set());
  const availableContacts = filterInvitableContacts(contacts, memberIds);
  const selectedContacts = availableContacts.filter(contact => selectedContactIds.has(contact.id));
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const typedCode = String(new FormData(event.currentTarget).get("code") || "").trim();
    if (selectedContacts.length || typedCode) onInvite(selectedContacts, typedCode);
  };
  const toggleContact = (contactId: string) => setSelectedContactIds(current => {
    const next = new Set(current);
    next.has(contactId) ? next.delete(contactId) : next.add(contactId);
    return next;
  });
  return <Modal onClose={onClose}><div className="flex items-start justify-between"><div><h2 className="text-lg font-bold">Convidar para o grupo</h2><p className="mt-1 text-sm text-slate-400">Selecione quantos contatos quiser ou use um código.</p></div><IconButton label="Fechar" onClick={onClose}><X size={18} /></IconButton></div><form onSubmit={submit}><div className="mt-5 flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-[.13em] text-slate-500">Seus contatos</p>{selectedContacts.length > 0 && <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-bold text-violet-200">{selectedContacts.length} selecionado(s)</span>}</div>{availableContacts.length ? <div className="mt-2 max-h-52 space-y-1 overflow-y-auto rounded-xl border border-white/[.08] bg-[#11131d] p-1.5">{availableContacts.map(contact => { const selected = selectedContactIds.has(contact.id); return <button type="button" key={contact.id} onClick={() => toggleContact(contact.id)} className={`flex w-full items-center gap-3 rounded-lg p-2 text-left transition ${selected ? "bg-violet-500/20 ring-1 ring-violet-400/60" : "hover:bg-white/[.06]"}`}><ProfileAvatar profile={contact} className="h-9 w-9" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{contact.displayName}</span><span className="block font-mono text-[10px] tracking-[.12em] text-slate-500">{contact.connectionCode}</span></span>{selected ? <Check size={17} className="text-violet-300" /> : <span className="h-4 w-4 rounded border border-white/[.18]" />}</button>; })}</div> : <p className="mt-2 rounded-xl border border-dashed border-white/[.1] p-3 text-center text-xs leading-5 text-slate-500">Todos os seus contatos já estão neste grupo.</p>}<div className="my-4 flex items-center gap-3 text-[10px] font-bold uppercase tracking-[.13em] text-slate-600"><i className="h-px flex-1 bg-white/[.08]" />adicionar por código<i className="h-px flex-1 bg-white/[.08]" /></div><Input name="code" maxLength={6} className="h-12 border-white/[.09] bg-[#11131d] font-mono uppercase tracking-[.2em] text-white" placeholder="AB12CD" /><Button className="mt-4 h-11 w-full rounded-xl bg-violet-500 hover:bg-violet-400"><UserPlus size={17} />{selectedContacts.length ? `Convidar ${selectedContacts.length} contato(s)` : "Enviar convite"}</Button></form></Modal>;
}

function ChannelModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, kind: "text" | "voice") => void }) {
  return <Modal onClose={onClose}><h2 className="text-lg font-bold">Criar canal</h2><form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); onCreate(String(data.get("name") || ""), data.get("kind") === "voice" ? "voice" : "text"); }}><div className="mt-5 flex items-center rounded-xl border border-white/[.09] bg-[#11131d] px-3"><Hash size={17} className="text-slate-500" /><Input name="name" required minLength={2} className="h-12 border-0 bg-transparent text-white shadow-none focus-visible:ring-0" placeholder="novo-canal" /></div><select name="kind" defaultValue="text" className="mt-3 h-10 w-full rounded-xl border border-white/[.09] bg-[#11131d] px-3 text-sm text-slate-200"><option value="text">Canal de texto</option><option value="voice">Canal de voz</option></select><Button className="mt-4 h-11 w-full rounded-xl bg-violet-500 hover:bg-violet-400"><Plus size={17} />Criar canal</Button></form></Modal>;
}

function ChannelManagerModal({ channels, onClose, onRename, onRemove }: { channels: Array<{ id: string; name: string; kind?: "text" | "voice" }>; onClose: () => void; onRename: (channelId: string, name: string) => void; onRemove: (channelId: string) => void }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const editing = channels.find(channel => channel.id === editingId) || null;
  const startEdit = (channel: { id: string; name: string }) => { setEditingId(channel.id); setName(channel.name); };
  return <Modal onClose={onClose}><div className="flex items-start justify-between"><div><h2 className="text-lg font-bold">Gerenciar canais</h2><p className="mt-1 text-sm text-slate-400">Toque em um canal para renomear ou remover.</p></div><IconButton label="Fechar" onClick={onClose}><X size={18} /></IconButton></div>{editing ? <form className="mt-5" onSubmit={event => { event.preventDefault(); onRename(editing.id, name); setEditingId(null); }}><p className="text-[11px] font-bold uppercase tracking-[.13em] text-slate-500">{editing.kind === "voice" ? "Canal de voz" : "Canal de texto"}</p><Input autoFocus value={name} onChange={event => setName(event.target.value)} required minLength={2} className="mt-2 h-11 border-white/[.09] bg-[#11131d] text-white" /><div className="mt-4 grid grid-cols-2 gap-2"><Button type="button" onClick={() => setEditingId(null)} variant="outline" className="border-white/[.1] text-slate-200">Voltar</Button><Button className="bg-violet-500 hover:bg-violet-400"><Pencil size={16} />Renomear</Button></div><Button type="button" onClick={() => { onRemove(editing.id); setEditingId(null); }} variant="outline" className="mt-3 h-10 w-full border-rose-400/30 text-rose-200 hover:bg-rose-500/15"><Trash2 size={16} />Remover canal</Button></form> : <div className="mt-5 space-y-1 rounded-xl border border-white/[.08] bg-[#11131d] p-1.5">{channels.map(channel => <button type="button" key={channel.id} onClick={() => startEdit(channel)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-white/[.06]">{channel.kind === "voice" ? <Volume2 size={17} className="text-violet-300" /> : <Hash size={17} className="text-slate-500" />}<span className="min-w-0 flex-1 truncate text-sm font-semibold">{channel.name}</span><Pencil size={15} className="text-slate-500" /></button>)}</div>}</Modal>;
}

function AccountManagerModal({ currentId, accounts, switchingAccount, onClose, onAdd, onSwitch, onLogout, onCancelSwitch }: { currentId: string; accounts: LocalAccountRecord[]; switchingAccount: LocalAccountRecord | null; onClose: () => void; onAdd: () => void; onSwitch: (account: LocalAccountRecord, password?: string) => void; onLogout: () => void; onCancelSwitch: () => void }) {
  return <Modal onClose={onClose}><div className="flex items-start justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[.15em] text-violet-300">Configurações</p><h2 className="mt-1 text-xl font-bold">Contas neste dispositivo</h2><p className="mt-1 text-sm text-slate-400">As senhas não são salvas e os dados de cada conta permanecem separados.</p></div><IconButton label="Fechar" onClick={onClose}><X size={18} /></IconButton></div>{switchingAccount ? <form className="mt-5" onSubmit={event => { event.preventDefault(); onSwitch(switchingAccount, String(new FormData(event.currentTarget).get("password") || "")); }}><p className="text-sm text-slate-300">Entre novamente em <strong>@{switchingAccount.username}</strong> para liberar a sessão oficial neste dispositivo.</p><Input name="password" type="password" required minLength={8} autoFocus className="mt-4 h-11 border-white/[.09] bg-[#11131d] text-white" placeholder="Senha da conta oficial" /><div className="mt-4 grid grid-cols-2 gap-2"><Button type="button" variant="outline" onClick={onCancelSwitch} className="border-white/[.1] bg-white/[.03] text-slate-300">Voltar</Button><Button className="bg-violet-500">Entrar</Button></div></form> : <><div className="mt-5 space-y-2">{accounts.map(account => <div key={account.id} className={`flex items-center gap-3 rounded-xl border p-3 ${account.id === currentId ? "border-violet-400/50 bg-violet-500/10" : "border-white/[.08] bg-[#11131d]"}`}><ProfileAvatar profile={account.store.profile || { displayName: account.displayName, avatarUrl: account.avatarUrl }} className="h-10 w-10" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{account.displayName}</p><p className="text-xs text-slate-400">{account.accountType === "official" ? `Conta oficial · @${account.username}` : "Conta Guest · código"}</p></div>{account.id === currentId ? <span className="text-[10px] font-bold uppercase tracking-[.12em] text-violet-300">Atual</span> : <Button type="button" variant="outline" onClick={() => onSwitch(account)} className="h-8 border-white/[.1] bg-white/[.03] px-3 text-xs text-slate-200">Trocar</Button>}</div>)}</div><div className="mt-4 grid grid-cols-2 gap-2"><Button type="button" onClick={onAdd} className="h-10 bg-violet-500 hover:bg-violet-400"><Plus size={16} />Adicionar conta</Button><Button type="button" variant="outline" onClick={onLogout} className="h-10 border-rose-400/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20">Sair desta conta</Button></div></>}</Modal>;
}

function GifPicker({ onSelect, onEmoji, onClose }: { onSelect: (attachment: LocalAttachment) => void; onEmoji: (emoji: string) => void; onClose: () => void }) {
  return <MediaPanel onSelect={onSelect} onEmoji={onEmoji} onClose={onClose} />;
}

function MediaPanel({ onSelect, onEmoji, onClose }: { onSelect: (attachment: LocalAttachment) => void; onEmoji: (emoji: string) => void; onClose: () => void }) {
  const [tab, setTab] = useState<"emoji" | "g" | "s">("emoji");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ id: string; mediaUrl: string; previewUrl: string; title: string; mimeType: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const emoji = ["😀", "😂", "😍", "😭", "😎", "👍", "❤️", "🔥", "🎉", "👀", "✅", "🙏", "😡", "🤔", "💀", "🥳"];
  const label = tab === "g" ? "GIFs" : "Figurinhas";
  const load = async (term = "popular") => {
    if (tab === "emoji") return;
    setLoading(true); setUnavailable(false);
    try {
      const response = await fetch(runtimeApiUrl(`/api/klipy/${tab}/search=${encodeURIComponent(term)}`));
      const payload = await response.json() as { results?: typeof results; message?: string };
      if (!response.ok || !Array.isArray(payload.results)) throw new Error(payload.message || "Indisponível");
      setResults(payload.results);
      setUnavailable(payload.results.length === 0);
    } catch { setResults([]); setUnavailable(true); } finally { setLoading(false); }
  };
  useEffect(() => { if (tab !== "emoji") void load(); }, [tab]);
  const selectMedia = (item: typeof results[number]) => { onSelect({ name: `${item.title || label}.${item.mimeType.includes("sticker") ? "webp" : "gif"}`, mimeType: item.mimeType || "image/gif", size: 0, dataUrl: item.mediaUrl }); onClose(); };

  return <><button aria-label="Fechar painel de mídia" type="button" onClick={onClose} className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px]" /><section role="dialog" aria-label="Emojis, GIFs e figurinhas" className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[74dvh] max-w-3xl rounded-t-[28px] border border-white/[.1] bg-[#1d1f2b] px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-2 shadow-[0_-20px_60px_rgba(0,0,0,.45)]"><div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-500/70" /><div className="flex items-center justify-between"><h2 className="text-base font-bold text-white">{tab === "emoji" ? "Emoji" : label}</h2><IconButton label="Fechar" onClick={onClose} className="h-8 w-8"><X size={18} /></IconButton></div><div className="mt-3 grid grid-cols-3 rounded-xl bg-[#12141d] p-1"><button type="button" onClick={() => setTab("emoji")} className={`rounded-lg py-2 text-sm font-bold ${tab === "emoji" ? "bg-[#363945] text-white" : "text-slate-400"}`}>Emoji</button><button type="button" onClick={() => setTab("g")} className={`rounded-lg py-2 text-sm font-bold ${tab === "g" ? "bg-[#363945] text-white" : "text-slate-400"}`}>GIFs</button><button type="button" onClick={() => setTab("s")} className={`rounded-lg py-2 text-sm font-bold ${tab === "s" ? "bg-[#363945] text-white" : "text-slate-400"}`}>Figurinhas</button></div>{tab === "emoji" ? <><div className="mt-4 flex items-center gap-2 rounded-xl border border-white/[.08] bg-[#12141d] px-3 py-2 text-sm text-slate-500"><Smile size={18} />Escolha um emoji</div><p className="mt-4 text-sm font-bold text-slate-300">Populares</p><div className="mt-3 grid grid-cols-8 gap-2 sm:grid-cols-10">{emoji.map(value => <button type="button" key={value} onClick={() => { onEmoji(value); onClose(); }} className="grid aspect-square place-items-center rounded-xl text-2xl transition hover:bg-white/[.09]">{value}</button>)}</div></> : <><form onSubmit={event => { event.preventDefault(); void load(query.trim() || "popular"); }} className="mt-4 flex gap-2"><Input value={query} onChange={event => setQuery(event.target.value)} className="h-10 border-white/[.09] bg-[#12141d] text-white" placeholder={`Pesquisar ${label.toLowerCase()}`} /><Button type="submit" className="h-10 bg-violet-500 px-4">Buscar</Button></form>{loading ? <p className="py-8 text-center text-sm text-slate-400">Carregando…</p> : unavailable ? <p className="py-8 text-center text-sm text-slate-400">Não foi possível carregar agora. Tente novamente mais tarde.</p> : <div className="mt-3 grid max-h-[38dvh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">{results.map(item => <button type="button" key={item.id} onClick={() => selectMedia(item)} className="overflow-hidden rounded-xl border border-white/[.08] bg-white/[.04] hover:border-violet-400/70"><img src={item.previewUrl} alt={item.title} loading="lazy" className="aspect-square h-full w-full object-cover" /></button>)}</div>}<label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-white/[.15] px-3 py-2.5 text-xs font-bold text-slate-300 hover:border-violet-400 hover:text-white"><ImagePlus size={16} />Escolher da galeria<input type="file" accept="image/gif,image/webp,image/png,image/*" className="hidden" onChange={async event => { try { const file = event.target.files?.[0]; if (file) { onSelect(await fileAsAttachment(file)); onClose(); } } catch (error) { toast.error(error instanceof Error ? error.message : "Arquivo inválido."); } }} /></label></>}</section></>;
}

function LegacyGifPicker({ onSelect, onClose }: { onSelect: (attachment: LocalAttachment) => void; onClose: () => void }) {
  const [kind, setKind] = useState<"g" | "s">("g");
  const [query, setQuery] = useState("reação");
  const [results, setResults] = useState<Array<{ id: string; mediaUrl: string; previewUrl: string; title: string; mimeType: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const search = async () => {
    setLoading(true); setUnavailable(false);
    try {
      const response = await fetch(`/api/klipy/${kind}/search=${encodeURIComponent(query.trim() || "reação")}`);
      const data = await response.json() as { ok?: boolean; results?: typeof results };
      if (!response.ok || !data.ok) { setResults([]); setUnavailable(true); return; }
      setResults(data.results || []); setUnavailable(!(data.results || []).length);
    } catch { setResults([]); setUnavailable(true); }
    finally { setLoading(false); }
  };
  const label = kind === "g" ? "GIFs" : "Figurinhas";
  return <Modal onClose={onClose}><div className="flex items-start justify-between"><div><h2 className="text-lg font-bold">GIFs e Figurinhas</h2><p className="mt-1 text-sm text-slate-400">Pesquise pelo servidor Klipy ou escolha uma figurinha pela galeria.</p></div><IconButton label="Fechar" onClick={onClose}><X size={18} /></IconButton></div><div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-white/[.04] p-1"><button type="button" onClick={() => { setKind("g"); setResults([]); setUnavailable(false); }} className={`rounded-lg py-2 text-sm font-bold ${kind === "g" ? "bg-violet-500 text-white" : "text-slate-400"}`}>GIFs</button><button type="button" onClick={() => { setKind("s"); setResults([]); setUnavailable(false); }} className={`rounded-lg py-2 text-sm font-bold ${kind === "s" ? "bg-violet-500 text-white" : "text-slate-400"}`}>Figurinhas</button></div><div className="mt-3 flex gap-2"><Input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} className="h-10 border-white/[.09] bg-[#11131d] text-white" placeholder="reação, meme…" /><Button type="button" onClick={() => void search()} className="h-10 bg-violet-500">Buscar</Button></div>{loading ? <p className="py-8 text-center text-sm text-slate-400">Buscando {label.toLowerCase()}…</p> : unavailable ? <div className="py-8 text-center text-sm text-slate-400"><p>Não foi possível encontrar resultados agora.</p><p className="mt-1 text-xs text-slate-500">Tente novamente mais tarde ou escolha um arquivo pela galeria.</p></div> : <div className="mt-4 grid max-h-72 grid-cols-3 gap-2 overflow-y-auto">{results.map(result => <button type="button" key={result.id} onClick={() => { onSelect({ name: `${result.title || label}.${result.mimeType.includes("sticker") ? "webp" : "gif"}`, mimeType: result.mimeType || "image/gif", size: 0, dataUrl: result.mediaUrl }); onClose(); }} className="overflow-hidden rounded-xl border border-white/[.08] bg-white/[.04] hover:border-violet-400/70"><img src={result.previewUrl} alt={result.title} loading="lazy" className="aspect-square h-full w-full object-cover" /></button>)}</div>}<label className="mt-4 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-white/[.15] px-3 py-3 text-xs font-bold text-slate-300 hover:border-violet-400 hover:text-white"><ImagePlus size={16} />Escolher GIF ou figurinha da galeria<input type="file" accept="image/gif,image/webp,image/png,image/*" className="hidden" onChange={async event => { try { const file = event.target.files?.[0]; if (file) { onSelect(await fileAsAttachment(file)); onClose(); } } catch (error) { toast.error(error instanceof Error ? error.message : "Arquivo inválido."); } }} /></label><p className="mt-4 text-[10px] leading-4 text-slate-500">Anexos enviados ao servidor ficam disponíveis por até 3 dias; a cópia local depende do armazenamento do seu navegador.</p></Modal>;
}
