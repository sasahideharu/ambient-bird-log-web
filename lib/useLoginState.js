"use client";

import { useEffect, useState } from "react";
import { getLoginState, onAuthChange } from "./auth";

// 画面から「ログイン中か」を知るための部品。ready は、判定が終わったかどうか
export function useLoginState() {
  const [state, setState] = useState({ ready: false, loggedIn: false, email: null });

  useEffect(() => {
    let alive = true;
    const apply = (s) => {
      if (alive) setState({ ready: true, loggedIn: s.loggedIn, email: s.email });
    };
    getLoginState().then(apply);
    const stop = onAuthChange(apply);
    return () => {
      alive = false;
      stop();
    };
  }, []);

  return state;
}
