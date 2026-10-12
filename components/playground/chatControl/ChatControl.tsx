"use client";
import React, { useState, useEffect, useRef } from "react";
import { Rnd } from "react-rnd";
import { usePanelZ } from "../panelStack";
import { generateText, tool, type LanguageModel, type UserContent } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { SettingsModal } from "./SettingsModal";
import { z } from "zod";
import {
  getApiKeyFromLocalStorage,
  getBaseURLFromLocalStorage,
  getSystemPromptFromLocalStorage,
  getModelFromLocalStorage,
  getProviderFromLocalStorage,
  getAnthropicApiKeyFromLocalStorage,
  getAnthropicModelFromLocalStorage,
  getChatCamerasFromLocalStorage,
  setChatCamerasToLocalStorage,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_OPENAI_MODEL,
} from "../../../lib/chatSettings";
import {
  CameraSnapshot,
  captureLocalCamera,
  captureRemoteCamera,
  localCameraNames,
  useKeepCamerasActive,
} from "@/lib/cameraFrames";
import useMeasure from "react-use-measure";
import { panelStyle } from "@/components/playground/panelStyle";

const IMAGE_TYPE = "sensor_msgs/msg/CompressedImage";
const CAMERA_TOPIC_PATTERN = /^\/(.+)\/image_raw\/compressed$/;

/** A camera the chat can send snapshots of. */
type ChatCamera = { name: string; topic?: string };

type ChatMessage = {
  sender: string;
  text: string;
  images?: CameraSnapshot[];
};

type ChatControlProps = {
  robotName?: string;
  systemPrompt?: string;
  onHide: () => void;
  show?: boolean; // 新增 show 属性
  /** Whether the ROS 2 bridge is connected; other devices' cameras need it. */
  rosConnected?: boolean;
  subscribeCompressedImage?: (
    topicName: string,
    callback: (base64Data: string, format: string) => void,
    throttleMs?: number
  ) => (() => void) | null;
  listTopicsForType?: (messageType: string) => Promise<string[]>;
};

/** This page's cameras, then other devices' cameras found on the ROS graph. */
async function listChatCameras(
  rosConnected: boolean,
  listTopicsForType?: (messageType: string) => Promise<string[]>
): Promise<ChatCamera[]> {
  const local = localCameraNames();
  const cameras: ChatCamera[] = local.map((name) => ({ name }));
  if (rosConnected && listTopicsForType) {
    try {
      for (const topic of (await listTopicsForType(IMAGE_TYPE)).sort()) {
        const name = topic.match(CAMERA_TOPIC_PATTERN)?.[1];
        // A camera this page publishes itself is read from its canvas.
        if (name && !local.includes(name)) cameras.push({ name, topic });
      }
    } catch {
      // rosapi missing or busy: local cameras only.
    }
  }
  return cameras;
}

export function ChatControl({
  robotName,
  systemPrompt: configSystemPrompt,
  onHide,
  show = true,
  rosConnected = false,
  subscribeCompressedImage,
  listTopicsForType,
}: ChatControlProps) {
  const [ref, bounds] = useMeasure();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  /** Cameras whose snapshots go with every message. */
  const [selectedCameras, setSelectedCameras] = useState<string[]>(() =>
    getChatCamerasFromLocalStorage()
  );
  const [showCameraPicker, setShowCameraPicker] = useState(false);
  const [availableCameras, setAvailableCameras] = useState<ChatCamera[] | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const { zIndex, bringToFront } = usePanelZ("chat");
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const provider = getProviderFromLocalStorage();
  const apiKey =
    provider === "anthropic" ? getAnthropicApiKeyFromLocalStorage() : getApiKeyFromLocalStorage();
  const systemPrompt =
    getSystemPromptFromLocalStorage(robotName) ||
    configSystemPrompt || // <-- Use configSystemPrompt if present
    `You can help control a robot by pressing keyboard keys. Use the keyPress tool to simulate key presses. Each key will be held down for 1 second by default. If the user describes roughly wanting to make it longer or shorter, adjust the duration accordingly.`;

  const createModel = (): LanguageModel => {
    if (provider === "anthropic") {
      const anthropic = createAnthropic({
        apiKey,
        // The Claude API refuses browser (CORS) requests without this. The key
        // is the user's own and never leaves their browser except to the API.
        headers: { "anthropic-dangerous-direct-browser-access": "true" },
      });
      return anthropic(getAnthropicModelFromLocalStorage() || DEFAULT_ANTHROPIC_MODEL);
    }
    const openai = createOpenAI({
      apiKey,
      baseURL: getBaseURLFromLocalStorage() || "https://api.openai.com/v1/",
    });
    return openai(getModelFromLocalStorage() || DEFAULT_OPENAI_MODEL);
  };

  // Local cameras only stream while their panel is open; keep them on while
  // the chat sends their snapshots, so a message does not wait for start-up.
  useKeepCamerasActive(show && selectedCameras.length > 0);

  const refreshCameras = async () => {
    setAvailableCameras(await listChatCameras(rosConnected, listTopicsForType));
  };

  const toggleCameraPicker = () => {
    if (!showCameraPicker) refreshCameras();
    setShowCameraPicker(!showCameraPicker);
  };

  const toggleCamera = (name: string) => {
    const next = selectedCameras.includes(name)
      ? selectedCameras.filter((n) => n !== name)
      : [...selectedCameras, name];
    setSelectedCameras(next);
    setChatCamerasToLocalStorage(next);
  };

  /** Snapshots of the selected cameras, and the names of those that gave none. */
  const captureSelected = async () => {
    const cameras = await listChatCameras(rosConnected, listTopicsForType);
    const results = await Promise.all(
      selectedCameras.map(async (name) => {
        const camera = cameras.find((c) => c.name === name);
        if (!camera) return null;
        if (!camera.topic) return captureLocalCamera(name);
        return subscribeCompressedImage
          ? captureRemoteCamera(subscribeCompressedImage, camera.topic, name)
          : null;
      })
    );
    const images = results.filter((r): r is CameraSnapshot => r !== null);
    const missing = selectedCameras.filter((name) => !images.some((i) => i.name === name));
    return { images, missing };
  };

  useEffect(() => {
    if (bounds.height > 0) {
      setPosition((pos) => ({
        ...pos,
        x: window.innerWidth - bounds.width - 20,
        y: 70,
      }));
    }
  }, [bounds.height]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const handleCommand = async (command: string) => {
    setBusy(true);
    const { images, missing } = await captureSelected();
    setMessages((prev) => [
      ...prev,
      {
        sender: "User",
        text:
          command +
          (missing.length > 0 ? `\n(no image from: ${missing.join(", ")})` : ""),
        images,
      },
    ]);
    // Each image is preceded by its camera's name, so the model can tell the
    // views apart and refer to them.
    const userContent: UserContent = [{ type: "text", text: command }];
    for (const image of images) {
      userContent.push({ type: "text", text: `Camera "${image.name}":` });
      userContent.push({ type: "image", image: image.base64, mimeType: image.mimeType });
    }
    try {
      const result = await generateText({
        model: createModel(),
        messages: [{ role: "user", content: userContent }],
        system: systemPrompt,
        tools: {
          keyPress: tool({
            description:
              "Press and hold a keyboard key for a specified duration (in milliseconds) to control the robot",
            parameters: z.object({
              key: z
                .string()
                .describe(
                  "The key to press (e.g., 'w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight')"
                ),
              duration: z
                .number()
                .int()
                .min(100)
                .max(5000)
                .default(1000)
                .describe(
                  "How long to hold the key in milliseconds (default: 1000, min: 100, max: 5000)"
                ),
            }),
            execute: async ({
              key,
              duration,
            }: {
              key: string;
              duration?: number;
            }) => {
              const holdTime = duration ?? 1000;
              const keydownEvent = new KeyboardEvent("keydown", {
                key,
                bubbles: true,
              });
              window.dispatchEvent(keydownEvent);

              // Wait for the specified duration
              await new Promise((resolve) => setTimeout(resolve, holdTime));

              // Simulate keyup event
              const keyupEvent = new KeyboardEvent("keyup", {
                key,
                bubbles: true,
              });
              window.dispatchEvent(keyupEvent);
              return `Held key "${key.toUpperCase()}" for ${holdTime} ms`;
            },
          }),
        },
      });
      let text = result.text.trim();
      for (const toolResult of result.toolResults) {
        text += `\n\n${toolResult.result}`;
      }
      setMessages((prev) => [...prev, { sender: "AI", text }]);
    } catch (error) {
      console.error("Error generating text:", error);
      setMessages((prev) => [
        ...prev,
        {
          sender: "AI",
          text: `Error: ${error instanceof Error ? error.message : "Unable to process your request."}`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const handleSend = () => {
    if (input.trim() && !busy) {
      if (!apiKey) {
        setShowSettings(true);
        return;
      }
      handleCommand(input.trim());
      setInput(""); // Clear input after sending
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSend();
    }
  };

  return (
    <Rnd
      position={position}
      onDragStop={(_, d) => setPosition({ x: d.x, y: d.y })}
      bounds="window"
      cancel="input, select, textarea, button"
      className="z-50"
      style={{ display: show ? undefined : "none", zIndex }}
    >
      <div onPointerDownCapture={bringToFront} ref={ref} className={"p-4 w-80 z-50 " + panelStyle}>
        <h4 className="border-b border-white/50  pb-2 font-bold mb-2 flex items-center justify-between">
          <span>AI Control Robot</span>
          <div className="flex gap-2">
            <button
              onClick={() => setShowSettings(true)}
              onTouchEnd={() => setShowSettings(true)}
              className="bg-zinc-700 hover:bg-zinc-600 text-white py-1 px-2 rounded text-sm"
            >
              Settings
            </button>
            <button
              onClick={onHide}
              onTouchEnd={onHide}
              className="text-xl hover:bg-zinc-800 px-2 rounded-full"
              title="Collapse"
            >
              ×
            </button>
          </div>
        </h4>
        <div className="mb-2 max-h-[60vh] overflow-y-auto">
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`mb-2 ${
                msg.sender === "AI" ? "text-green-400" : "text-blue-400"
              }`}
            >
              <strong>{msg.sender}:</strong>{" "}
              <span className="whitespace-pre-wrap">{msg.text}</span>
              {msg.images && msg.images.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {msg.images.map((image) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={image.name}
                      src={`data:${image.mimeType};base64,${image.base64}`}
                      alt={image.name}
                      title={image.name}
                      className="h-16 rounded"
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
          {busy && <div className="mb-2 text-xs text-zinc-400">Thinking…</div>}
          <div ref={messagesEndRef} />
        </div>
        {messages.length > 0 && (
          <div className="mb-2 flex justify-end">
            <button
              onClick={() => setMessages([])}
              className="text-xs bg-zinc-700 hover:bg-zinc-600 text-white px-2 py-1 rounded"
            >
              Clear
            </button>
          </div>
        )}
        {showCameraPicker && (
          <div className="mb-2 rounded bg-zinc-800/80 p-2 text-sm">
            <div className="mb-1 flex items-center justify-between text-xs text-zinc-400">
              <span>Send snapshots of</span>
              <button onClick={refreshCameras} className="hover:text-white">
                Refresh
              </button>
            </div>
            {availableCameras === null ? (
              <div className="text-xs text-zinc-500">Looking for cameras…</div>
            ) : (
              <>
                {availableCameras.map((camera) => (
                  <label key={camera.name} className="flex items-center gap-2 py-0.5">
                    <input
                      type="checkbox"
                      checked={selectedCameras.includes(camera.name)}
                      onChange={() => toggleCamera(camera.name)}
                    />
                    <span className="font-mono">{camera.name}</span>
                    {camera.topic && <span className="text-xs text-zinc-500">other device</span>}
                  </label>
                ))}
                {/* Selected earlier but not around now: still listed, so it can be unticked. */}
                {selectedCameras
                  .filter((name) => !availableCameras.some((c) => c.name === name))
                  .map((name) => (
                    <label key={name} className="flex items-center gap-2 py-0.5 text-zinc-500">
                      <input type="checkbox" checked onChange={() => toggleCamera(name)} />
                      <span className="font-mono">{name}</span>
                      <span className="text-xs">not found</span>
                    </label>
                  ))}
                {availableCameras.length === 0 && selectedCameras.length === 0 && (
                  <div className="text-xs text-zinc-500">
                    No cameras. Add one in the Webcam panel
                    {rosConnected ? "" : ", or connect ROS 2 for other devices' cameras"}.
                  </div>
                )}
              </>
            )}
          </div>
        )}
        <div className="flex items-center space-x-2">
          <div className="relative flex items-center w-full">
            <button
              onClick={toggleCameraPicker}
              title={
                selectedCameras.length > 0
                  ? `Sending snapshots of: ${selectedCameras.join(", ")}`
                  : "Send camera snapshots with messages"
              }
              className={
                "absolute left-0 p-2 rounded " +
                (selectedCameras.length > 0
                  ? "bg-blue-600 hover:bg-blue-500 text-white"
                  : "bg-zinc-700 hover:bg-zinc-600 text-zinc-400")
              }
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="w-5 h-5"
                aria-hidden="true"
              >
                <path d="M16 4C16.5523 4 17 4.44772 17 5V9.2L22.2133 5.55071C22.4395 5.39235 22.7513 5.44737 22.9096 5.6736C22.9684 5.75764 23 5.85774 23 5.96033V18.0397C23 18.3158 22.7761 18.5397 22.5 18.5397C22.3974 18.5397 22.2973 18.5081 22.2133 18.4493L17 14.8V19C17 19.5523 16.5523 20 16 20H2C1.44772 20 1 19.5523 1 19V5C1 4.44772 1.44772 4 2 4H16ZM15 6H3V18H15V6ZM7.4 8.82867C7.47607 8.82867 7.55057 8.85036 7.61475 8.8912L11.9697 11.6625C12.1561 11.7811 12.211 12.0284 12.0924 12.2148C12.061 12.2641 12.0191 12.306 11.9697 12.3375L7.61475 15.1088C7.42837 15.2274 7.18114 15.1725 7.06254 14.9861C7.02169 14.9219 7 14.8474 7 14.7713V9.22867C7 9.00776 7.17909 8.82867 7.4 8.82867ZM21 8.84131L17 11.641V12.359L21 15.1587V8.84131Z"></path>{" "}
              </svg>
            </button>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              onKeyDown={(e) => e.stopPropagation()}
              onKeyUp={(e) => e.stopPropagation()}
              placeholder={busy ? "Waiting for the model..." : "Type a command..."}
              disabled={busy}
              className="flex-1 pl-10 p-2 rounded bg-zinc-700 text-white outline-none text-sm disabled:opacity-60"
            />
          </div>
        </div>
      </div>
      <SettingsModal
        show={showSettings}
        onClose={() => setShowSettings(false)}
        robotName={robotName}
        systemPrompt={configSystemPrompt}
      />
    </Rnd>
  );
}
