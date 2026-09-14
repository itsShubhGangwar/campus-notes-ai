import React, { useState } from 'react';
import { Download, ExternalLink, Maximize2, Minimize2, FileText } from 'lucide-react';

interface PDFViewerProps {
  fileUrl: string;
  fileName: string;
  noteId: string;
  onDownload?: () => void;
}

export const PDFViewer: React.FC<PDFViewerProps> = ({
  fileUrl,
  fileName,
  noteId,
  onDownload,
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);

  // In standard browser environments, streaming via /api/notes/:id/file directly in an iframe/embed
  // leverages the native PDF renderer with search, zoom, and page navigation.
  const streamUrl = fileUrl.startsWith('http')
    ? fileUrl
    : `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api'}/notes/${noteId}/file`;

  const downloadUrl = `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api'}/notes/${noteId}/download`;

  return (
    <div
      className={`bg-slate-900 rounded-2xl overflow-hidden border border-slate-800 flex flex-col transition-all duration-300 ${
        isFullscreen ? 'fixed inset-4 z-50 shadow-2xl' : 'w-full h-[650px]'
      }`}
    >
      {/* PDF Viewer Header Bar */}
      <div className="bg-slate-800/90 backdrop-blur px-4 py-3 flex items-center justify-between border-b border-slate-700 text-white">
        <div className="flex items-center gap-2 truncate max-w-md">
          <FileText className="w-4 h-4 text-brand-400 flex-shrink-0" />
          <span className="text-xs font-semibold truncate text-slate-200">{fileName}</span>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={downloadUrl}
            onClick={onDownload}
            download={fileName}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-sm transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download</span>
          </a>

          <a
            href={streamUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
            title="Open in new window"
          >
            <ExternalLink className="w-4 h-4" />
          </a>

          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
            title={isFullscreen ? 'Exit full screen' : 'Full screen'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* PDF Document Container */}
      <div className="flex-grow w-full h-full bg-slate-950 relative">
        <iframe
          src={`${streamUrl}#toolbar=1&navpanes=0`}
          title={fileName}
          className="w-full h-full border-none"
        />
      </div>
    </div>
  );
};
