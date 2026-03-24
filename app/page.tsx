"use client";

import { Suspense } from "react";
import RobotLoader from "@/components/playground/RobotLoader";

export default function Home() {
  return (
    <div className="relative w-screen h-dvh">
      <Suspense>
        <RobotLoader robotName="so-arm101" />
      </Suspense>
    </div>
  );
}
