import {useState, useEffect, useCallback, useRef} from 'react';

export interface ViewportInfo {
  /** 可见视口高度 (px)，键盘弹起时会缩小 */
  height: number;
  /** 可见视口宽度 (px) */
  width: number;
  /** 键盘是否处于弹起状态 */
  keyboardVisible: boolean;
  /** 键盘估算高度 (px) */
  keyboardHeight: number;
  /** 是否为移动端设备 */
  isMobile: boolean;
}

function detectMobile(): boolean {
  if (typeof window === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    ('ontouchstart' in window && window.innerWidth <= 1024);
}

/**
 * 监听 VisualViewport 变化，返回当前视口信息。
 * 在移动端虚拟键盘弹起/收起时自动更新，驱动布局适配。
 */
export function useViewport(): ViewportInfo {
  const isMobile = useRef(detectMobile()).current;

  const getInfo = useCallback((): ViewportInfo => {
    const vv = window.visualViewport;
    const width = vv?.width ?? window.innerWidth;
    const height = vv?.height ?? window.innerHeight;
    const fullHeight = window.innerHeight;
    const keyboardHeight = Math.max(0, fullHeight - height);
    // 阈值：键盘高度超过屏幕 15% 才判定为键盘弹起，避免地址栏收缩的误判
    const keyboardVisible = isMobile && keyboardHeight > fullHeight * 0.15;

    return {width, height, keyboardVisible, keyboardHeight, isMobile};
  }, [isMobile]);

  const [info, setInfo] = useState<ViewportInfo>(getInfo);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => setInfo(getInfo());
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [getInfo]);

  // 监听 orientationchange 和 resize 作为降级方案
  useEffect(() => {
    const update = () => setInfo(getInfo());
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, [getInfo]);

  return info;
}
