"use client";
import Script from "next/script";
import Link from "next/link";
import { useState, useEffect } from "react";
// import { Bell } from "lucide-react";
import { RiNotification2Line } from "@remixicon/react";

import { NotificationDialog } from "@/components/NotificationDialog";

export default function Header() {
  const [showNotification, setShowNotification] = useState(false);
  const [hasNew, setHasNew] = useState(false);
  const NOTIFICATION_KEY = "bambot-update-2024-05";

  useEffect(() => {
    if (!localStorage.getItem(NOTIFICATION_KEY)) {
      setHasNew(true);
    }
  }, []);

  const handleBellClick = () => {
    setShowNotification(true);
  };

  const handleCloseNotification = () => {
    setShowNotification(false);
    if (hasNew) {
      localStorage.setItem(NOTIFICATION_KEY, "true");
      setHasNew(false);
    }
  };

  return (
    <>
      <header className="text-white w-full p-5 sm:px-10 flex justify-between items-center fixed top-0 left-0 right-0 z-50">
        <button
          onClick={handleBellClick}
          className="relative"
          title="Notifications"
        >
          <RiNotification2Line className="text-white w-5 h-5" />
          {hasNew && (
            <span className="absolute top-0 right-0 block h-2 w-2 rounded-full bg-red-500 ring-2 ring-zinc-800" />
          )}
        </button>
      </header>
      <NotificationDialog
        open={showNotification}
        onOpenChange={setShowNotification}
        onClose={handleCloseNotification}
      />
    </>
  );
}
