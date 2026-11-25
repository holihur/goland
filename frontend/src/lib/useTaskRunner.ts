import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import { api, taskSocket } from "./api";
import type { TaskInfo } from "./types";
import type { BottomView } from "./layout";

export function useTaskRunner({
  workspaceId,
  refreshKey,
  bottomView,
  openOutput,
  onFinished,
}: {
  workspaceId: string;
  refreshKey: number;
  bottomView: BottomView;
  openOutput: () => void;
  onFinished: () => void;
}) {
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [output, setOutput] = useState("No task output yet.");
  const [runningTask, setRunningTask] = useState<TaskInfo | null>(null);
  const taskSocketRef = useRef<WebSocket | null>(null);
  const outputRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .listTasks(workspaceId)
      .then((result) => alive && setTasks(result.tasks))
      .catch(() => alive && setTasks([]));
    return () => {
      alive = false;
    };
  }, [workspaceId, refreshKey]);

  useEffect(() => {
    return () => {
      taskSocketRef.current?.close();
      taskSocketRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!outputRef.current) return;
    outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [output, bottomView]);

  const stopTask = useCallback(() => {
    const socket = taskSocketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "cancel" }));
    }
  }, []);

  const runTask = useCallback(
    (task: TaskInfo) => {
      taskSocketRef.current?.close();
      setRunningTask(task);
      openOutput();
      setOutput(`$ ${task.command} ${task.args.join(" ")}\n`);
      const socket = new WebSocket(taskSocket(workspaceId, task.id));
      taskSocketRef.current = socket;
      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        try {
          const message = JSON.parse(event.data) as {
            type?: string;
            data?: string;
            status?: string;
            exitCode?: number;
            message?: string;
          };
          if (message.type === "output" && message.data) {
            setOutput((current) => (current.length > 700_000 ? current.slice(-500_000) : current) + message.data);
          } else if (message.type === "started") {
            setOutput((current) => `${current}[started]\n`);
          } else if (message.type === "exit") {
            setOutput((current) => `${current}\n[exit ${message.exitCode ?? 0} · ${message.status ?? "finished"}]\n`);
            setRunningTask(null);
            onFinished();
          } else if (message.type === "error") {
            setOutput((current) => `${current}\n[error] ${message.message ?? "task failed"}\n`);
            setRunningTask(null);
          }
        } catch {
          setOutput((current) => current + event.data);
        }
      };
      socket.onerror = () => {
        toast.error("Task connection failed");
        setRunningTask(null);
      };
      socket.onclose = () => {
        setRunningTask((current) => (current?.id === task.id ? null : current));
      };
    },
    [workspaceId, openOutput, onFinished],
  );

  return {
    tasks,
    output,
    setOutput,
    runningTask,
    outputRef: outputRef as RefObject<HTMLPreElement | null>,
    runTask,
    stopTask,
  };
}
