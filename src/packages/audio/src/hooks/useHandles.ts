import { useEffect, useState } from "react";

interface HandlesHook {
  handles: Handle[];
  addHandle: (id: string) => void;
  removeHandle: (id: string) => void;
  isLoaded: boolean;
}

interface Handle {
  id: string;
}

export function useHandles(): HandlesHook {
  const [handles, setHandles] = useState<Handle[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setIsLoaded(true);
    return () => {
      setIsLoaded(false);
    };
  }, []);

  function addHandle(id: string) {
    const handle: Handle = {
      id,
    };

    setHandles((old) => [...old, handle]);
  }

  function removeHandle(id: string) {
    setHandles((old) => old.filter((handle) => handle.id !== id));
  }

  return {
    handles,
    addHandle,
    removeHandle,
    isLoaded,
  };
}
