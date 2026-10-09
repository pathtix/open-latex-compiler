import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { EventBus, PDFLinkService, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { SyncBox } from "../lib/api";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfViewerHandle {
  zoomIn(): void;
  zoomOut(): void;
  setScale(value: string): void;
  goToPage(page: number): void;
  showBoxes(boxes: SyncBox[]): void;
  /** Source position (in PDF points, top-left origin) at the centre of the view. */
  centerPoint(): { page: number; x: number; y: number } | null;
}

interface Props {
  url: string | null;
  onPages?: (info: { page: number; pages: number }) => void;
  onScale?: (info: { scale: number; value: string }) => void;
  onInverseSearch?: (page: number, x: number, y: number) => void;
  onError?: (message: string) => void;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 6;

export const PdfViewerView = forwardRef<PdfViewerHandle, Props>(function PdfViewerView({ url, onPages, onScale, onInverseSearch, onError }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const pdfViewer = useRef<PDFViewer | null>(null);
  const links = useRef<PDFLinkService | null>(null);
  const doc = useRef<pdfjs.PDFDocumentProxy | null>(null);
  const restore = useRef<{ scaleValue: string; top: number; left: number } | null>(null);
  const cbs = useRef({ onPages, onScale, onInverseSearch, onError });
  cbs.current = { onPages, onScale, onInverseSearch, onError };

  useEffect(() => {
    const container = containerRef.current!;
    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus, externalLinkTarget: 2 });
    const viewer = new PDFViewer({
      container,
      viewer: viewerRef.current!,
      eventBus,
      linkService,
      textLayerMode: 1,
      removePageBorders: false,
      annotationEditorMode: -1,
    });
    linkService.setViewer(viewer);
    pdfViewer.current = viewer;
    links.current = linkService;

    eventBus.on("pagesinit", () => {
      const r = restore.current;
      viewer.currentScaleValue = r?.scaleValue ?? "page-width";
      if (r) {
        container.scrollTop = r.top;
        container.scrollLeft = r.left;
      }
      cbs.current.onPages?.({ page: viewer.currentPageNumber, pages: viewer.pagesCount });
    });
    eventBus.on("pagechanging", (e: { pageNumber: number }) => {
      cbs.current.onPages?.({ page: e.pageNumber, pages: viewer.pagesCount });
    });
    eventBus.on("scalechanging", (e: { scale: number; presetValue?: string }) => {
      cbs.current.onScale?.({ scale: e.scale, value: e.presetValue ?? String(e.scale) });
    });

    // Ctrl/Cmd + wheel (and trackpad pinch) zooms around the pointer.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
      const next = viewer.currentScale * factor;
      if (next < MIN_SCALE || next > MAX_SCALE) return;
      viewer.updateScale({ drawingDelay: 250, scaleFactor: factor, origin: [e.clientX, e.clientY] });
    };
    container.addEventListener("wheel", onWheel, { passive: false });

    const onDbl = (e: MouseEvent) => {
      const pageEl = (e.target as HTMLElement).closest(".page") as HTMLElement | null;
      if (!pageEl) return;
      const pageNumber = Number(pageEl.dataset.pageNumber);
      const pt = toPdfPoint(viewer, pageNumber, e.clientX, e.clientY);
      if (pt) cbs.current.onInverseSearch?.(pageNumber, pt.x, pt.y);
      window.getSelection()?.removeAllRanges();
    };
    container.addEventListener("dblclick", onDbl);

    // Keep "fit" zoom modes fitted when the pane is resized.
    const ro = new ResizeObserver(() => {
      const v = viewer.currentScaleValue;
      if (doc.current && (v === "page-width" || v === "page-fit" || v === "auto")) viewer.currentScaleValue = v;
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("dblclick", onDbl);
      viewer.setDocument(null as never);
      void doc.current?.loadingTask.destroy();
      doc.current = null;
      pdfViewer.current = null;
    };
  }, []);

  useEffect(() => {
    const viewer = pdfViewer.current;
    const container = containerRef.current;
    if (!viewer || !container) return;
    if (!url) {
      viewer.setDocument(null as never);
      void doc.current?.loadingTask.destroy();
      doc.current = null;
      cbs.current.onPages?.({ page: 0, pages: 0 });
      return;
    }
    let cancelled = false;
    let loaded = false;
    const task = pdfjs.getDocument({
      url,
      cMapUrl: "/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdfjs/standard_fonts/",
      wasmUrl: "/pdfjs/wasm/",
      iccUrl: "/pdfjs/iccs/",
    });
    task.promise.then(
      (pdf) => {
        if (cancelled) {
          void pdf.loadingTask.destroy();
          return;
        }
        loaded = true;
        restore.current = doc.current ? { scaleValue: viewer.currentScaleValue, top: container.scrollTop, left: container.scrollLeft } : restore.current;
        const old = doc.current;
        doc.current = pdf;
        viewer.setDocument(pdf);
        links.current?.setDocument(pdf);
        if (old) void old.loadingTask.destroy();
      },
      (err: Error) => {
        if (!cancelled) cbs.current.onError?.(err.message);
      },
    );
    return () => {
      cancelled = true;
      // A loaded document stays on screen until its replacement is ready.
      if (!loaded) void task.destroy().catch(() => {});
    };
  }, [url]);

  useImperativeHandle(ref, () => ({
    zoomIn() {
      pdfViewer.current?.increaseScale({ drawingDelay: 150 });
    },
    zoomOut() {
      pdfViewer.current?.decreaseScale({ drawingDelay: 150 });
    },
    setScale(value: string) {
      if (pdfViewer.current && doc.current) pdfViewer.current.currentScaleValue = value;
    },
    goToPage(page: number) {
      const v = pdfViewer.current;
      if (v && page >= 1 && page <= v.pagesCount) v.currentPageNumber = page;
    },
    showBoxes(boxes: SyncBox[]) {
      const v = pdfViewer.current;
      const container = containerRef.current;
      if (!v || !container || !boxes.length) return;
      const page = boxes[0].page;
      const pv = v.getPageView(page - 1);
      if (!pv) return;
      const vp = pv.viewport;
      const [, , , vbTop] = vp.viewBox as number[];
      const vbLeft = (vp.viewBox as number[])[0];
      let firstTop = Infinity;
      for (const b of boxes.filter((x) => x.page === page)) {
        const [x1, y1] = vp.convertToViewportPoint(b.h + vbLeft, vbTop - (b.v - b.H));
        const [x2, y2] = vp.convertToViewportPoint(b.h + vbLeft + Math.max(b.W, 20), vbTop - b.v);
        const el = document.createElement("div");
        el.className = "synctex-mark";
        el.style.left = `${Math.min(x1, x2) - 2}px`;
        el.style.top = `${Math.min(y1, y2) - 2}px`;
        el.style.width = `${Math.abs(x2 - x1) + 4}px`;
        el.style.height = `${Math.max(Math.abs(y2 - y1), 8) + 4}px`;
        pv.div.appendChild(el);
        setTimeout(() => el.remove(), 1800);
        firstTop = Math.min(firstTop, Math.min(y1, y2));
      }
      const target = pv.div.offsetTop + (Number.isFinite(firstTop) ? firstTop : 0) - container.clientHeight * 0.3;
      container.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
    },
    centerPoint() {
      const v = pdfViewer.current;
      const container = containerRef.current;
      if (!v || !container || !doc.current) return null;
      const rect = container.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 3;
      const el = document.elementFromPoint(cx, cy)?.closest(".page") as HTMLElement | null;
      const page = el ? Number(el.dataset.pageNumber) : v.currentPageNumber;
      const pt = toPdfPoint(v, page, cx, cy);
      return pt ? { page, ...pt } : null;
    },
  }));

  return (
    <div className="pdf-scroll" ref={containerRef}>
      <div className="pdfViewer" ref={viewerRef} />
    </div>
  );
});

/** Converts a client coordinate on a page into SyncTeX coordinates (points, top-left origin). */
function toPdfPoint(viewer: PDFViewer, pageNumber: number, clientX: number, clientY: number) {
  const pv = viewer.getPageView(pageNumber - 1);
  if (!pv) return null;
  const wrapper = (pv.div.querySelector(".canvasWrapper") as HTMLElement | null) ?? pv.div;
  const r = wrapper.getBoundingClientRect();
  const [px, py] = pv.viewport.convertToPdfPoint(clientX - r.left, clientY - r.top) as number[];
  const vb = pv.viewport.viewBox as number[];
  return { x: px - vb[0], y: vb[3] - py };
}
