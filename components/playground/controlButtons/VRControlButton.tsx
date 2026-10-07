import GlassButton from "./GlassButton";
import { RiGamepadLine } from "@remixicon/react";

interface VRControlButtonProps {
  showControlPanel: boolean;
  onToggleControlPanel: () => void;
}

export default function VRControlButton({
  showControlPanel,
  onToggleControlPanel,
}: VRControlButtonProps) {
  return (
    <GlassButton
      onClick={onToggleControlPanel}
      icon={<RiGamepadLine size={24} />}
      tooltip="VR Control"
      pressed={showControlPanel}
    />
  );
}
