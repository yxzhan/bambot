export type RosJointState = {
  header: {
    stamp: { sec: number; nanosec: number };
    frame_id: string;
  };
  name: string[];
  position: number[];
  velocity: number[];
  effort: number[];
};

export type RosJointStateCallback = (state: RosJointState) => void;
