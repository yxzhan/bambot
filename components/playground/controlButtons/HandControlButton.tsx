import GlassButton from "./GlassButton";
import { RiHand } from "@remixicon/react";

interface HandControlButtonProps {
  showControlPanel: boolean;
  onToggleControlPanel: () => void;
}

export default function HandControlButton({
  showControlPanel,
  onToggleControlPanel,
}: HandControlButtonProps) {
  return (
    <GlassButton
      onClick={onToggleControlPanel}
      icon={<RiHand size={24} />}
      tooltip="Hand Control"
      pressed={showControlPanel}
    />
  );
}
