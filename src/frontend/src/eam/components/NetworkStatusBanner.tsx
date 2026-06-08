import React, { useState, useEffect } from 'react';
import { WifiOff, Wifi } from 'lucide-react';

export const NetworkStatusBanner: React.FC = () => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setShowReconnected(true);
      setTimeout(() => setShowReconnected(false), 3000);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setShowReconnected(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline && !showReconnected) return null;

  return (
    <div
      className={`
        flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium
        transition-all duration-300 animate-in slide-in-from-top
        ${isOnline
          ? 'bg-green-50 text-green-700 border-b border-green-200'
          : 'bg-amber-50 text-amber-800 border-b border-amber-200'
        }
      `}
    >
      {isOnline ? (
        <>
          <Wifi size={14} className="text-green-500" />
          <span>Back online — connection restored</span>
        </>
      ) : (
        <>
          <WifiOff size={14} className="text-amber-600" />
          <span>You're offline — some features may be unavailable</span>
        </>
      )}
    </div>
  );
};
