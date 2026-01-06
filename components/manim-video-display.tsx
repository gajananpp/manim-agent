"use client";

import { Video } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { subscribeToVideoUrl, getVideoUrl } from "@/components/thread-wrapper";

export function ManimVideoDisplay() {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // Subscribe to video URL stream
  useEffect(() => {
    // Set initial value
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVideoUrl(getVideoUrl());
    
    // Subscribe to updates
    const unsubscribe = subscribeToVideoUrl((url) => {
      setVideoUrl(url);
    });
    
    return unsubscribe;
  }, []);
  
  // Autoplay video when URL changes
  useEffect(() => {
    if (videoUrl && videoRef.current) {
      // Reset and play the video
      videoRef.current.load();
      videoRef.current.play().catch((error) => {
        // Autoplay might be blocked by browser, that's okay
        console.log("Autoplay prevented:", error);
      });
    }
  }, [videoUrl]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border/50 bg-muted/30 px-4 py-3 h-[52px] flex items-center">
        <div className="flex items-center gap-2 text-base font-semibold">
          <Video className="h-4 w-4 text-primary" />
          <span>Manim Video</span>
        </div>
      </div>
      {/* Content */}
      <div className="flex-1 overflow-hidden bg-linear-to-br from-slate-950/50 via-slate-900/30 to-slate-950/50 dark:from-slate-950/80 dark:via-slate-900/60 dark:to-slate-950/80 min-h-0">
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            autoPlay
            loop
            muted
            playsInline
            className="w-full h-full object-contain"
          >
            Your browser does not support the video tag.
          </video>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <Video className="h-8 w-8 opacity-30" />
            <p className="text-sm font-medium">No video available yet</p>
            <p className="text-xs opacity-70">Video will appear here after code execution</p>
          </div>
        )}
      </div>
    </div>
  );
}

