import GlassButton from "./GlassButton";
import { RiVideoAddLine } from "@remixicon/react";

interface WebcamButtonProps {
  showControlPanel: boolean;
  onToggleControlPanel: () => void;
}

export default function WebcamButton({
  showControlPanel,
  onToggleControlPanel,
}: WebcamButtonProps) {
  return (
    <GlassButton
      onClick={onToggleControlPanel}
      icon={<RiVideoAddLine size={24} />}
      tooltip="Webcam View"
      pressed={showControlPanel}
    />
  );
}
