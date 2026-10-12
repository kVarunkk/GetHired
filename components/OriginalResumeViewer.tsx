"use client";

import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "@/utils/utils";
import {
  ZoomIn,
  ZoomOut,
  Download,
  AlertCircle,
  RefreshCcw,
  Loader2,
} from "lucide-react";
import { Document, Page, pdfjs, type DocumentProps } from "react-pdf";
// import "react-pdf/dist/Page/TextLayer.css";

if (typeof window !== "undefined" && pdfjs) {
  try {
    // prefer ESM worker from local package (suitable for modern bundlers)
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
  } catch {
    // fallback to a widely-available UMD worker on CDN
    pdfjs.GlobalWorkerOptions.workerSrc =
      "https://unpkg.com/pdfjs-dist/build/pdf.worker.min.js";
  }
}

// US Letter (11 / 8.5). Used until the PDF's own first-page ratio is known.
const DEFAULT_PAGE_RATIO = 11 / 8.5;
// Upper bound on the drawing width (CSS px), to keep canvas memory in check.
const MAX_RENDER_WIDTH = 1600;
// How long the width must hold still before the pages are redrawn larger.
const RENDER_RESIZE_DELAY_MS = 150;

interface OriginalResumeViewerProps {
  url: string;
  className?: string;
  showControls?: boolean;
}

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
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [pageRatio, setPageRatio] = useState(DEFAULT_PAGE_RATIO);
  // One placeholder covers fetching, parsing and drawing, and stays until every
  // page has drawn. Swapping placeholders between those stages is what flickered.
  const [isRendered, setIsRendered] = useState(false);
  const settledPages = useRef(new Set<number>());

  useEffect(() => {
    let isCurrent = true;

    const fetchRawBlob = async () => {
      setDebugError(null);
      setPdfBlob(null);
      setNumPages(null);
      setIsRendered(false);
      settledPages.current.clear();

      // Some callers fetch the signed URL themselves and pass "" until it arrives;
      // keep the placeholder up meanwhile.
      if (!url) return;

      try {
        if (!URL.canParse(url))
          throw new Error("Invalid source URL provided to viewer.");

        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(
            `Connection failed (${response.status}). Check network.`,
          );
        }

        const blob = await response.blob();

        if (isCurrent) setPdfBlob(blob);
      } catch (err) {
        if (isCurrent) {
          setDebugError(
            err instanceof Error ? err.message : JSON.stringify(err),
          );
        }
      }
    };

    fetchRawBlob();
    return () => {
      isCurrent = false;
    };
  }, [url]);

  // Track the container's width (not just the window's), so the pages fit inside
  // dialogs and resizable panes too. A layout effect measures it before the first
  // paint, so the placeholder never shows at a guessed size and then jumps.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateWidth = () => {
      // Subtract padding to ensure the canvas fits perfectly
      setContainerWidth(Math.max(el.clientWidth - 58, 0));
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const onDocumentLoadSuccess: NonNullable<DocumentProps["onLoadSuccess"]> = (
    pdf,
  ) => {
    setNumPages(pdf.numPages);
    // Size the placeholder like the real pages, so nothing jumps when they draw.
    pdf
      .getPage(1)
      .then((page) => {
        const { width, height } = page.getViewport({ scale: 1 });
        if (width > 0) setPageRatio(height / width);
      })
      .catch(() => {});
  };

  // Counts failed pages too, so one bad page can't keep the placeholder up forever.
  const onPageSettled = (pageNumber: number) => {
    settledPages.current.add(pageNumber);
    if (numPages && settledPages.current.size >= numPages) setIsRendered(true);
  };

  const pageWidth = containerWidth > 0 ? containerWidth * scale : 0;

  // The pages are drawn at renderWidth and scaled to pageWidth with CSS. Redrawing
  // blanks the canvas until it's done, so redrawing on every width change made the
  // pages flash while the sidebar animated. Instead renderWidth only grows, and is
  // sized for the whole window up front, so opening or closing the sidebar never
  // redraws. Zooming in past it redraws once the zoom settles.
  const [renderWidth, setRenderWidth] = useState(0);
  useEffect(() => {
    if (pageWidth <= 0) return;
    const id = setTimeout(
      () => {
        const wanted = Math.ceil(
          Math.max(
            pageWidth,
            Math.min(window.innerWidth * scale, MAX_RENDER_WIDTH),
          ),
        );
        setRenderWidth((prev) => (wanted > prev ? wanted : prev));
      },
      renderWidth === 0 ? 0 : RENDER_RESIZE_DELAY_MS,
    );
    return () => clearTimeout(id);
  }, [pageWidth, scale, renderWidth]);

  const pageSize =
    pageWidth > 0
      ? { width: pageWidth, height: pageWidth * pageRatio }
      : { width: "min(100%, 612px)", aspectRatio: `1 / ${pageRatio}` };

  const handleDownload = () => {
    if (!url) return;
    window.open(url, "_blank");
  };
  const handlePdfError = (err: Error) => {
    setDebugError(
      `${err.name}: ${err.message}\n\nStack: ${err.stack?.slice(0, 300)}...`,
    );
  };

  return (
    <div className={cn("flex flex-col h-full bg-background", className)}>
      {/* Viewer Controls */}
      {showControls && (
        <div className="flex items-center flex-wrap justify-between py-3 border-b border-border sticky top-0 z-20 bg-background">
          <button
            onClick={handleDownload}
            className="p-2 text-xs hover:text-brand transition-colors bg-secondary rounded-lg font-medium flex items-center gap-1"
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
            {/* Space is kept for the page count so the toolbar doesn't shift when it arrives. */}
            <div
              className={cn(
                "text-xs font-medium text-muted-foreground bg-secondary p-2 rounded-lg select-none",
                !numPages && "invisible",
              )}
            >
              {numPages ?? 1} {numPages === 1 ? "Page" : "Pages"}
            </div>
          </div>
        </div>
      )}

      {/* PDF Canvas Area. The stable gutter stops a scrollbar appearing mid-load from
          changing the width and forcing the pages to redraw. */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto p-6 bg-muted/30 [scrollbar-gutter:stable]"
      >
        <div className="flex flex-col w-fit mx-auto pb-10">
          {debugError ? (
            <div className="flex flex-col items-center justify-center p-10 text-center gap-4">
              <div className="h-12 w-12 rounded-full bg-destructive/5 flex items-center justify-center border border-destructive/40 text-destructive">
                <AlertCircle />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">Document Error</p>
                <p className="text-xs text-muted-foreground">{debugError}</p>
              </div>
              <button
                onClick={() => window.location.reload()}
                className="text-xs font-medium underline underline-offset-4 hover:text-brand transition-colors flex items-center gap-1"
              >
                <RefreshCcw size={12} /> Retry Connection
              </button>
            </div>
          ) : (
            <div className="relative">
              {!isRendered && (
                <div
                  role="status"
                  aria-label="Loading resume"
                  className="flex items-center justify-center rounded-sm border bg-muted"
                  style={pageSize}
                >
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}
              {pdfBlob && (
                // Drawn hidden behind the placeholder, then shown in one step.
                <div
                  aria-hidden={!isRendered}
                  className={cn(
                    !isRendered && "invisible absolute inset-0 overflow-hidden",
                  )}
                >
                  <Document
                    file={pdfBlob}
                    onLoadSuccess={onDocumentLoadSuccess}
                    onLoadError={handlePdfError}
                    onSourceError={handlePdfError}
                    renderMode="canvas"
                    loading={null}
                    error={null}
                  >
                    <div className="flex flex-col gap-8">
                      {Array.from(
                        new Array(renderWidth > 0 ? numPages || 0 : 0),
                        (el, index) => (
                          <div
                            key={`page_${index + 1}`}
                            style={{ width: pageWidth }}
                          >
                            <Page
                              pageNumber={index + 1}
                              width={renderWidth}
                              loading={
                                <div
                                  aria-hidden
                                  className="rounded-sm border bg-muted"
                                  style={pageSize}
                                />
                              }
                              onRenderSuccess={() => onPageSettled(index + 1)}
                              onRenderError={() => onPageSettled(index + 1)}
                              onLoadError={() => onPageSettled(index + 1)}
                              className="border rounded-sm overflow-hidden bg-white [&_canvas]:!w-full [&_canvas]:!h-auto"
                              renderAnnotationLayer={false}
                              renderTextLayer={false}
                            />
                          </div>
                        ),
                      )}
                    </div>
                  </Document>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
