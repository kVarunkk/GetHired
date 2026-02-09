"use client";

import React, { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Loader2, ZoomIn, ZoomOut, Download } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
// pdfjs.GlobalWorkerOptions.workerSrc = new URL(
//   "pdfjs-dist/build/pdf.worker.min.mjs",
//   import.meta.url,
// ).toString();

// Fallback: if module worker isn't supported or the bundler environment
// doesn't resolve the .mjs worker correctly on mobile, use the CDN UMD worker.
try {
  // prefer ESM worker from local package (suitable for modern bundlers)
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
} catch {
  // fallback to a widely-available UMD worker on CDN
  // Note: using an explicit CDN version avoids issues on some mobile browsers.
  pdfjs.GlobalWorkerOptions.workerSrc =
    "https://unpkg.com/pdfjs-dist/build/pdf.worker.min.js";
}

interface OriginalResumeViewerProps {
  url: string;
  className?: string;
  showControls?: boolean;
}

/**
 * OriginalResumeViewer
 * A standalone, reusable PDF viewer optimized for resumes.
 * Features continuous vertical scrolling and responsive width scaling.
 */
export default function OriginalResumeViewer({
  url,
  className,
  showControls = true,
}: OriginalResumeViewerProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [scale, setScale] = useState(1.0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [debugError, setDebugError] = useState<string | null>(null);

  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  // const [isLoading, setIsLoading] = useState(true);

  // 1. MANUAL BLOB FETCHING (The "GitHub Solution" adapted for URLs)
  // This downloads the entire file into memory as a Blob first.
  useEffect(() => {
    if (!url) return;
    let isCurrent = true;
    let localUrl: string | null = null;

    const fetchAsBlob = async () => {
      try {
        const response = await fetch(url);
        if (!response.ok)
          throw new Error(`Source access failed: ${response.status}`);

        const blob = await response.blob();
        localUrl = URL.createObjectURL(blob);

        if (isCurrent) {
          setBlobUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return localUrl;
          });
        }
      } catch (err) {
        if (isCurrent) {
          setDebugError(
            `Source Error: ${err instanceof Error ? err.message : JSON.stringify(err)}`,
          );
        }
      }
    };

    fetchAsBlob();
    return () => {
      isCurrent = false;
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [url]);

  // Handle Container Resizing for Responsive PDF
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        // Subtract padding to ensure the canvas fits perfectly
        setContainerWidth(containerRef.current.clientWidth - 58);
      }
    };
    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
  };

  const handleDownload = () => {
    if (!url) return;
    window.open(url, "_blank");
  };
  const handlePdfError = (err: Error) => {
    setDebugError(
      `${err.name}: ${err.message}\n\nStack: ${err.stack?.slice(0, 300)}...`,
    );
  };
  try {
    return (
      <div
        className={cn(
          "flex flex-col h-full  bg-white dark:bg-zinc-950",
          className,
        )}
      >
        {debugError && <div>{debugError}</div>}
        {/* Viewer Controls */}
        {showControls && (
          <div className="flex items-center flex-wrap justify-between py-3 border-b border-border sticky top-0 z-20 bg-background">
            <button
              onClick={handleDownload}
              className="p-2 text-xs  hover:text-brand transition-colors bg-secondary rounded-lg font-bold  flex items-center gap-1"
              title="Download Resume"
            >
              <Download size={14} />
              <span className="hidden sm:inline">Download</span>
            </button>

            <div className="flex items-center gap-2">
              <div className="flex items-center bg-secondary rounded-lg p-1">
                <button
                  onClick={() => setScale((s) => Math.max(s - 0.1, 0.5))}
                  className="p-1 hover:text-brand transition-colors"
                  title="Zoom Out"
                >
                  <ZoomOut size={14} />
                </button>
                <span className="text-[10px] font-mono px-2  text-center select-none">
                  {Math.round(scale * 100)}%
                </span>
                <button
                  onClick={() => setScale((s) => Math.min(s + 0.1, 2.0))}
                  className="p-1 hover:text-brand transition-colors"
                  title="Zoom In"
                >
                  <ZoomIn size={14} />
                </button>
              </div>
              {numPages && (
                <div className="text-xs font-bold text-muted-foreground bg-secondary p-2 rounded-lg select-none">
                  {numPages} {numPages === 1 ? "Page" : "Pages"}
                </div>
              )}
            </div>
          </div>
        )}

        {/* PDF Canvas Area */}
        <div
          ref={containerRef}
          className="flex-1  overflow-auto p-6  bg-zinc-100/50 dark:bg-zinc-900/20"
        >
          <div className="flex flex-col w-fit mx-auto pb-10">
            <Document
              file={blobUrl || url}
              onLoadSuccess={onDocumentLoadSuccess}
              onLoadError={handlePdfError}
              onSourceError={handlePdfError}
              renderMode="canvas"
              loading={
                <div className="flex flex-col items-center justify-center py-20 gap-4">
                  <Loader2 className="animate-spin h-8 w-8" />
                  <p className="text-xs font-bold text-muted-foreground">
                    Rendering PDF...
                  </p>
                </div>
              }
              error={
                <div className="p-10 text-center bg-red-50 dark:bg-red-950/20 rounded-xl border border-red-100">
                  <p className="text-sm text-red-600 font-medium">
                    Failed to render PDF.
                  </p>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs underline mt-2 inline-block"
                  >
                    Open in new tab
                  </a>
                </div>
              }
            >
              <div className="flex flex-col gap-8">
                {Array.from(new Array(numPages || 0), (el, index) => (
                  <Page
                    key={`page_${index + 1}`}
                    pageNumber={index + 1}
                    scale={scale}
                    width={containerWidth > 0 ? containerWidth : undefined}
                    className="shadow-2xl border border-zinc-200 dark:border-zinc-800 rounded-sm overflow-hidden bg-white"
                    renderAnnotationLayer={false}
                    renderTextLayer={false}
                  />
                ))}
              </div>
            </Document>
          </div>
        </div>
      </div>
    );
  } catch (e) {
    return <div className="p-4">{JSON.stringify(e)}</div>;
  }
}
