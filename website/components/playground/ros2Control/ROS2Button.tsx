import GlassButton from "../controlButtons/GlassButton";
import { RiRobot2Line } from "@remixicon/react";

interface ROS2ButtonProps {
  showControlPanel: boolean;
  onToggleControlPanel: () => void;
}

export default function ROS2Button({
  showControlPanel,
  onToggleControlPanel,
}: ROS2ButtonProps) {
  return (
    <GlassButton
      onClick={onToggleControlPanel}
      icon={<RiRobot2Line size={24} />}
      tooltip="ROS 2 Bridge"
      pressed={showControlPanel}
    />
  );
}
