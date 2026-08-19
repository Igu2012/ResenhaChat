let activeMedia: Pick<HTMLMediaElement, "pause"> | null = null;

export function activateExclusiveMedia(media: Pick<HTMLMediaElement, "pause">) {
  if (activeMedia && activeMedia !== media) activeMedia.pause();
  activeMedia = media;
}

export function clearExclusiveMedia(media: Pick<HTMLMediaElement, "pause">) {
  if (activeMedia === media) activeMedia = null;
}

export function resetExclusiveMediaPlayback() {
  activeMedia = null;
}
