import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { getTags, getActors, getAllCategories } from '../utils/api';

const ONBOARDING_KEY = 'changli_onboarding_done';

interface TutorialStep {
  page: string;
  title: string;
  content: string;
  highlight: string;
  waitForClick?: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  scrollIntoView?: boolean;
  isModalStep?: boolean;
  nextButtonText?: string;
  isLastStep?: boolean;
}

// 获取动态教程步骤
const getSteps = (hasData: boolean, hasScanPath: boolean, hasUserTags: boolean): TutorialStep[] => {
  // 新用户（无数据）
  if (!hasData) {
    return [
      // 首页
      {
        page: '/',
        title: '欢迎来到长离',
        content: '这是你的私人视频库。顶部可以快速进入视频库和演员库，也可以从导航栏进入。',
        highlight: '[data-tutorial="home-hero"]',
        position: 'bottom',
      },
      {
        page: '/',
        title: '我的追番',
        content: '追番的视频会在这里展示，方便你快速追更和观看。',
        highlight: '[data-tutorial="home-favorites"]',
        position: 'bottom',
      },
      {
        page: '/',
        title: '我的分类',
        content: '每个分类都会在首页展示最近观看的视频，方便你快速接续。',
        highlight: '[data-tutorial="home-example-category"]',
        position: 'bottom',
        scrollIntoView: true,
      },
      {
        page: '/',
        title: '进入视频库',
        content: '点击进入视频库看看 →',
        highlight: '[data-tutorial="go-library"]',
        waitForClick: '[data-tutorial="go-library"]',
        position: 'bottom',
        scrollIntoView: true,
      },
      // 视频库
      {
        page: '/library',
        title: '分类管理',
        content: '所有视频都按分类管理。已预设了「示例分类」，你还可以在设置内的分类管理编辑、创建不同的分类，比如「动漫」「影视」「教程视频」「宝宝成长记录」，随你定义。',
        highlight: '[data-tutorial="library-categories"]',
        position: 'bottom',
        scrollIntoView: true,
      },
      {
        page: '/library',
        title: '添加视频',
        content: '点击「添加」选择视频文件夹，系统会自动识别视频文件。',
        highlight: '[data-tutorial="add-videos"]',
        position: 'left',
      },
      {
        page: '/library',
        title: '全量检查更新',
        content: '分类配置中可以设置默认扫描路径，当本地预设的默认扫描路径下内容有变动时，点击这里可以全量自动同步新增和已移除的视频。当前置灰状态是因为示例分类未配置扫描路径。',
        highlight: '[data-tutorial="scan-update"]',
        position: 'left',
      },
      {
        page: '/library',
        title: '筛选',
        content: '已为你预置了「动作」「科幻」标签，你可以通过标签、演员、不同状态及标记来筛选视频，也可以通过设置「标签管理」来新增编辑删除标签。',
        highlight: '[data-tutorial="library-filters"]',
        position: 'bottom',
        scrollIntoView: true,
      },
      {
        page: '/library',
        title: '示例视频集',
        content: '这是示例视频集，点击进入详情页看看。后续也可以通过新建视频集或添加时自动识别更多的视频集。',
        highlight: '[data-tutorial="video-card"]',
        waitForClick: '[data-tutorial="video-card"]',
        position: 'right',
        scrollIntoView: true,
      },
      // 视频集详情页
      {
        page: '/series/1',
        title: '视频集信息',
        content: '这里展示视频集的海报和信息。右键左侧区域可进入编辑，来添加和修改标题、海报、标签、演员等。',
        highlight: '[data-tutorial="series-hero"]',
        position: 'bottom',
        scrollIntoView: true,
      },
      {
        page: '/series/1',
        title: '选集',
        content: '这里可以存放视频，点击即可播放。当前示例视频集无资源，后续本地资源更新后，可通过右键海报选择「检查更新」自动扫描新视频，也可通过添加视频手动添加。',
        highlight: '[data-tutorial="series-episodes"]',
        position: 'bottom',
        scrollIntoView: true,
      },
      {
        page: '/series/1',
        title: '关联演员',
        content: '点击演员名称可以进入演员详情页 →',
        highlight: '[data-tutorial="series-actors"]',
        waitForClick: '[data-tutorial="series-actors"] a',
        position: 'bottom',
      },
      // 演员详情页
      {
        page: '/actors/1',
        title: '演员信息',
        content: '这里展示演员的详细信息和海报，你可以通过编辑，添加演员的生日、身高、体重、简介以及添加多张海报，想完善更多用户信息也可通过设置「演员配置」设置自定义字段来记录你想保存的信息。',
        highlight: '[data-tutorial="actor-hero"]',
        position: 'bottom',
        scrollIntoView: true,
      },
      {
        page: '/actors/1',
        title: '参演作品',
        content: '关联视频后，这里会展示演员参演的所有作品。',
        highlight: '[data-tutorial="actor-works"]',
        position: 'top',
        scrollIntoView: true,
      },
      // 演员库
      {
        page: '/actors',
        title: '演员管理',
        content: '在这里可以快速找到所有演员，也可以添加你喜爱的新演员或家庭成员。',
        highlight: '[data-tutorial="actors-content"]',
        position: 'bottom',
        scrollIntoView: true,
      },
      {
        page: '/tags',
        title: '标签管理',
        content: '这里可以整理全局标签和特殊标签，让视频筛选更清楚。',
        highlight: '[data-tutorial="tags-page"]',
        position: 'bottom',
        scrollIntoView: true,
      },
      {
        page: '/subscriptions',
        title: '订阅管理',
        content: '这里可以管理订阅，集中检查作品有没有新内容。',
        highlight: '[data-tutorial="subscriptions-page"]',
        position: 'bottom',
        scrollIntoView: true,
      },
      {
        page: '/downloads',
        title: '下载管理',
        content: '下载任务会放在这里，方便以后统一查看和管理。',
        highlight: '[data-tutorial="downloads-page"]',
        position: 'bottom',
        scrollIntoView: true,
      },
      {
        page: '/completion',
        title: '影评记录',
        content: '看完的作品可以在这里补评分和短评，给自己留一点回忆。',
        highlight: '[data-tutorial="completion-page"]',
        position: 'bottom',
        scrollIntoView: true,
      },
      {
        page: 'current',
        title: '前往设置',
        content: '最后带你看看设置 →',
        highlight: '[data-tutorial="go-settings"]',
        waitForClick: '[data-tutorial="go-settings"]',
        position: 'left',
      },
      // 设置页
      {
        page: '/settings',
        title: '导航栏控制',
        content: '这里可以决定哪些入口显示在导航栏里，也能用上移、下移调整顺序。首页和视频是基础入口，会固定保留。',
        highlight: '[data-tutorial="settings-nav"]',
        position: 'bottom',
        scrollIntoView: true,
      },
      {
        page: '/settings',
        title: '分类配置',
        content: '在这里可以管理、新增、编辑、删除分类，以及配置分类的功能开关和扫描路径。',
        highlight: '[data-tutorial="settings-categories"]',
        position: 'bottom',
        scrollIntoView: true,
      },
      {
        page: '/settings',
        title: '演员配置',
        content: '添加自定义字段来记录你想保存的信息。',
        highlight: '[data-tutorial="settings-actors"]',
        position: 'bottom',
        scrollIntoView: true,
      },
      // 完成
      {
        page: '/settings',
        title: '🎉 搞定！',
        content: '「关于」里可以打开 GitHub、反馈问题或赞助支持。想再次观看指引可以点击「新手引导」按钮。还有很多功能等你慢慢发掘～',
        highlight: '[data-tutorial="settings-about-content"]',
        position: 'top',
        scrollIntoView: true,
        isLastStep: true,
      },
    ];
  }

  // 老用户（已有数据）
  return [
    // 首页
    {
      page: '/',
      title: '欢迎来到长离',
      content: '这是你的私人视频库，顶部可以快速进入视频库和演员库，也可以从导航栏进入。',
      highlight: '[data-tutorial="home-hero"]',
      position: 'bottom',
    },
    {
      page: '/',
      title: '我的追番',
      content: '追番的视频会在这里展示，方便你快速追更和观看。',
      highlight: '[data-tutorial="home-favorites"]',
      position: 'bottom',
    },
    {
      page: '/',
      title: '我的分类',
      content: '每个分类都会在首页展示最近观看的视频，方便你快速接续观看。',
      highlight: '[data-tutorial="home-example-category"]',
      position: 'bottom',
      scrollIntoView: true,
    },
    {
      page: '/',
      title: '进入视频库',
      content: '点击进入视频库看看 →',
      highlight: '[data-tutorial="go-library"]',
      waitForClick: '[data-tutorial="go-library"]',
      position: 'bottom',
      scrollIntoView: true,
    },
    // 视频库
    {
      page: '/library',
      title: '分类管理',
      content: '所有视频都按分类管理，你可以在设置内的分类管理编辑、创建不同的分类，比如「动漫」「影视」「教程视频」「宝宝成长记录」，随你定义。',
      highlight: '[data-tutorial="library-categories"]',
      position: 'bottom',
      scrollIntoView: true,
    },
    {
      page: '/library',
      title: '添加视频',
      content: '点击「添加」选择视频文件夹，系统会自动识别视频文件。',
      highlight: '[data-tutorial="add-videos"]',
      position: 'left',
    },
    {
      page: '/library',
      title: '全量检查更新',
      content: hasScanPath 
        ? '当本地资源有变动时，点击这里自动同步新增和移除的视频。'
        : '分类配置中可以设置默认扫描路径，当本地预设的默认扫描路径下内容有变动时，点击这里可以全量自动同步新增和已移除的视频。当前置灰状态是因为未配置扫描路径。',
      highlight: '[data-tutorial="scan-update"]',
      position: 'left',
    },
    {
      page: '/library',
      title: '筛选',
      content: hasUserTags
        ? '你可以通过标签、演员、不同状态及标记来筛选视频。'
        : '你可以通过标签、演员、不同状态及标记来筛选视频，也可以通过设置「标签管理」来新增编辑删除标签。',
      highlight: '[data-tutorial="library-filters"]',
      position: 'bottom',
      scrollIntoView: true,
    },
    // 老用户跳过视频集详情页，直接到演员库
    {
      page: '/actors',
      title: '演员管理',
      content: '在这里可以快速找到所有演员，也可以添加你喜爱的新演员或家庭成员。',
      highlight: '[data-tutorial="actors-content"]',
      position: 'bottom',
      scrollIntoView: true,
    },
    {
      page: '/actors',
      title: '查看演员详情',
      content: '点击第一个演员进入详情页看看 →',
      highlight: '[data-tutorial="first-actor"]',
      waitForClick: '[data-tutorial="first-actor"]',
      position: 'right',
      scrollIntoView: true,
    },
    // 演员详情页 - 使用 dynamic 页面标识，等待用户点击演员后自动检测
    {
      page: 'dynamic:/actors/',  // 动态匹配，任何演员详情页都算
      title: '演员信息',
      content: '这里展示演员的详细信息和海报，你可以通过编辑，添加演员的生日、身高、体重、简介以及添加多张海报，想完善更多用户信息也可通过设置「演员配置」设置自定义字段来记录你想保存的信息。',
      highlight: '[data-tutorial="actor-hero"]',
      position: 'bottom',
      scrollIntoView: true,
    },
    {
      page: 'dynamic:/actors/',  // 保持在当前演员详情页
      title: '参演作品',
      content: '关联视频后，这里会展示演员参演的所有作品。',
      highlight: '[data-tutorial="actor-works"]',
      position: 'top',
      scrollIntoView: true,
    },
    {
      page: '/tags',
      title: '标签管理',
      content: '这里可以整理全局标签和特殊标签，让视频筛选更清楚。',
      highlight: '[data-tutorial="tags-page"]',
      position: 'bottom',
      scrollIntoView: true,
    },
    {
      page: '/subscriptions',
      title: '订阅管理',
      content: '这里可以管理订阅，集中检查作品有没有新内容。',
      highlight: '[data-tutorial="subscriptions-page"]',
      position: 'bottom',
      scrollIntoView: true,
    },
    {
      page: '/downloads',
      title: '下载管理',
      content: '下载任务会放在这里，方便以后统一查看和管理。',
      highlight: '[data-tutorial="downloads-page"]',
      position: 'bottom',
      scrollIntoView: true,
    },
    {
      page: '/completion',
      title: '影评记录',
      content: '看完的作品可以在这里补评分和短评，给自己留一点回忆。',
      highlight: '[data-tutorial="completion-page"]',
      position: 'bottom',
      scrollIntoView: true,
    },
    {
      page: 'current',  // 不跳转，保持在当前页面
      title: '前往设置',
      content: '最后带你看看设置 →',
      highlight: '[data-tutorial="go-settings"]',
      waitForClick: '[data-tutorial="go-settings"]',
      position: 'left',
    },
    // 设置页
    {
      page: '/settings',
      title: '导航栏控制',
      content: '这里可以决定哪些入口显示在导航栏里，也能用上移、下移调整顺序。首页和视频是基础入口，会固定保留。',
      highlight: '[data-tutorial="settings-nav"]',
      position: 'bottom',
      scrollIntoView: true,
    },
    {
      page: '/settings',
      title: '分类配置',
      content: '在这里可以管理、新增、编辑、删除分类，以及配置分类的功能开关和扫描路径。',
      highlight: '[data-tutorial="settings-categories"]',
      position: 'bottom',
      scrollIntoView: true,
    },
    {
      page: '/settings',
      title: '演员配置',
      content: '添加自定义字段来记录你想保存的信息。',
      highlight: '[data-tutorial="settings-actors"]',
      position: 'bottom',
      scrollIntoView: true,
    },
    // 完成
    {
      page: '/settings',
      title: '🎉 搞定！',
      content: '「关于」里可以打开 GitHub、反馈问题或赞助支持。想再次观看指引可以点击「新手引导」按钮。还有很多功能等你慢慢发掘～',
      highlight: '[data-tutorial="settings-about-content"]',
      position: 'top',
      scrollIntoView: true,
      isLastStep: true,
    },
  ];
};

// 关闭所有可能打开的弹窗
const closeAllModals = () => {
  const cancelAddActor = document.querySelector('[data-tutorial="cancel-add-actor"]');
  if (cancelAddActor) (cancelAddActor as HTMLElement).click();
  const modalBackdrop = document.querySelector('.changli-modal-backdrop');
  if (modalBackdrop) {
    const cancelBtn = modalBackdrop.querySelector('button');
    if (cancelBtn && cancelBtn.textContent === '取消') cancelBtn.click();
  }
};

export const OnboardingTutorial: React.FC = () => {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [spotlight, setSpotlight] = useState<DOMRect | null>(null);
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [hasData, setHasData] = useState(false);
  const [hasScanPath, setHasScanPath] = useState(false);
  const [hasUserTags, setHasUserTags] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const clickHandlerRef = useRef<((e: MouseEvent) => void) | null>(null);
  const updateTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // 检查用户是否有数据
  useEffect(() => {
    const checkUserData = async () => {
      try {
        const [categories, actors, tags] = await Promise.all([
          getAllCategories(),
          getActors(),
          getTags(),
        ]);
        // 如果有超过预置数据（1个分类、1个演员、2个标签），说明是老用户
        const isExistingUser = categories.length > 1 || actors.length > 1 || tags.length > 2;
        setHasData(isExistingUser);
        
        // 检查是否有分类配置了扫描路径
        const hasPath = categories.some(cat => cat.scan_path && cat.scan_path.trim() !== '');
        setHasScanPath(hasPath);
        
        // 检查是否有用户创建的标签（超过预置的2个）
        setHasUserTags(tags.length > 2);
      } catch (error) {
        console.error('[Tutorial] 检查用户数据失败:', error);
        setHasData(false);
      }
    };
    checkUserData();
  }, []);

  // 监听外部触发的教程启动事件
  useEffect(() => {
    const handleStartOnboarding = () => {
      setStepIndex(0);
      setActive(true);
    };
    window.addEventListener('start-onboarding', handleStartOnboarding);
    return () => window.removeEventListener('start-onboarding', handleStartOnboarding);
  }, []);

  const steps = getSteps(hasData, hasScanPath, hasUserTags);

  useEffect(() => {
    const done = localStorage.getItem(ONBOARDING_KEY);
    if (!done) {
      const timer = setTimeout(() => setActive(true), 500);
      return () => clearTimeout(timer);
    }
  }, []);

  const currentStep = active ? steps[stepIndex] : null;
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === steps.length - 1;

  // 页面跳转
  useEffect(() => {
    if (!currentStep) return;
    // 'current' 表示不跳转，等待用户点击
    if (currentStep.page === 'current') return;
    // 'dynamic:' 开头表示动态匹配，只要当前路径以该前缀开头就行
    if (currentStep.page.startsWith('dynamic:')) {
      const prefix = currentStep.page.slice(8); // 移除 'dynamic:' 前缀
      if (location.pathname.startsWith(prefix)) return; // 已经在正确的页面
    }
    if (currentStep.page !== location.pathname && !currentStep.page.startsWith('dynamic:')) {
      setSpotlight(null);
      setIsVisible(false);
      navigate(currentStep.page);
    }
  }, [currentStep?.page, stepIndex]);

  // 高亮定位
  useEffect(() => {
    if (!currentStep || !active) {
      setSpotlight(null);
      setIsVisible(false);
      return;
    }

    if (updateTimerRef.current) {
      clearTimeout(updateTimerRef.current);
    }

    const updateSpotlight = () => {
      const el = document.querySelector(currentStep.highlight);
      if (el && currentStep.highlight !== 'body') {
        if (currentStep.scrollIntoView) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' }); // 使用 start 而不是 center
          updateTimerRef.current = setTimeout(() => {
            setSpotlight(el.getBoundingClientRect());
            setIsVisible(true);
          }, 300); // 等待滚动完成后再获取位置
        } else {
          updateTimerRef.current = setTimeout(() => {
            setSpotlight(el.getBoundingClientRect());
            setIsVisible(true);
          }, 50); // 给DOM渲染一点时间
        }
      } else {
        updateTimerRef.current = setTimeout(() => {
          const retryEl = document.querySelector(currentStep.highlight);
          if (retryEl) {
            if (currentStep.scrollIntoView) {
              retryEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
              setTimeout(() => {
                setSpotlight(retryEl.getBoundingClientRect());
                setIsVisible(true);
              }, 300);
            } else {
              setSpotlight(retryEl.getBoundingClientRect());
              setIsVisible(true);
            }
          } else {
            if (stepIndex < steps.length - 1) {
              setStepIndex(stepIndex + 1);
            }
          }
        }, 300);
      }
    };

    const initTimer = setTimeout(updateSpotlight, 50); // 给页面渲染多一点时间

    const handleResize = () => {
      const el = document.querySelector(currentStep.highlight);
      if (el) setSpotlight(el.getBoundingClientRect());
    };

    window.addEventListener('resize', handleResize);
    return () => {
      clearTimeout(initTimer);
      if (updateTimerRef.current) clearTimeout(updateTimerRef.current);
      window.removeEventListener('resize', handleResize);
    };
  }, [currentStep, active, location.pathname]);

  // 监听 waitForClick
  useEffect(() => {
    if (!currentStep?.waitForClick || !active) return;

    if (clickHandlerRef.current) {
      document.removeEventListener('click', clickHandlerRef.current, true);
    }

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const clickTarget = document.querySelector(currentStep.waitForClick!);
      if (clickTarget && (clickTarget === target || clickTarget.contains(target))) {
        setTimeout(() => handleNext(), 200);
      }
    };

    clickHandlerRef.current = handleClick;
    document.addEventListener('click', handleClick, true);

    return () => {
      document.removeEventListener('click', handleClick, true);
    };
  }, [currentStep, active, stepIndex]);

  const handleNext = useCallback(() => {
    setIsVisible(false);
    setTimeout(() => {
      if (stepIndex < steps.length - 1) {
        setStepIndex(stepIndex + 1);
      } else {
        handleFinish();
      }
    }, 20);
  }, [stepIndex]);

  const handlePrev = useCallback(() => {
    closeAllModals();
    setIsVisible(false);
    setSpotlight(null);

    const prevIndex = stepIndex - 1;
    if (prevIndex < 0) return;

    const prevStep = steps[prevIndex];
    const needNavigate = prevStep.page !== location.pathname;

    if (needNavigate) {
      navigate(prevStep.page);
      setTimeout(() => {
        setStepIndex(prevIndex);
      }, 300);
    } else {
      setTimeout(() => {
        setStepIndex(prevIndex);
      }, 20);
    }
  }, [stepIndex, location.pathname]);

  const handleSkipAll = () => {
    setShowSkipConfirm(true);
  };

  const confirmSkipAll = () => {
    closeAllModals();
    setShowSkipConfirm(false);
    handleFinish();
  };

  const handleFinish = () => {
    closeAllModals();
    setActive(false);
    localStorage.setItem(ONBOARDING_KEY, '1');
  };

  if (!active || !currentStep) return null;

  const padding = 10;
  const isClickable = !!currentStep.waitForClick;
  const isModalStep = currentStep.isModalStep;

  const getTooltipStyle = (): React.CSSProperties => {
    if (!spotlight) return {};
    const tooltipWidth = 280;
    const tooltipHeight = 140;
    const gap = 12;
    const margin = 16;

    let pos = currentStep.position || 'bottom';
    let top = 0;
    let left = 0;

    switch (pos) {
      case 'bottom':
        top = spotlight.bottom + gap;
        left = spotlight.left + spotlight.width / 2 - tooltipWidth / 2;
        if (top + tooltipHeight > window.innerHeight - margin) {
          top = spotlight.top - gap - tooltipHeight;
        }
        break;
      case 'top':
        top = spotlight.top - gap - tooltipHeight;
        left = spotlight.left + spotlight.width / 2 - tooltipWidth / 2;
        if (top < margin) {
          top = spotlight.bottom + gap;
        }
        break;
      case 'left':
        top = spotlight.top + spotlight.height / 2 - tooltipHeight / 2;
        left = spotlight.left - gap - tooltipWidth;
        if (left < margin) {
          left = spotlight.right + gap;
        }
        break;
      case 'right':
        top = spotlight.top + spotlight.height / 2 - tooltipHeight / 2;
        left = spotlight.right + gap;
        if (left + tooltipWidth > window.innerWidth - margin) {
          left = spotlight.left - gap - tooltipWidth;
        }
        break;
    }

    top = Math.max(margin, Math.min(top, window.innerHeight - tooltipHeight - margin));
    left = Math.max(margin, Math.min(left, window.innerWidth - tooltipWidth - margin));

    return { top, left };
  };

  return (
    <>
      <div className="fixed inset-0 z-[9999]" style={{ pointerEvents: isModalStep ? 'none' : 'auto' }}>
        {spotlight && (
          <>
            <div
              className="absolute rounded-xl"
              style={{
                top: spotlight.top - padding,
                left: spotlight.left - padding,
                width: spotlight.width + padding * 2,
                height: spotlight.height + padding * 2,
                boxShadow: isModalStep ? 'none' : '0 0 0 9999px rgba(0, 0, 0, 0.5)',
                background: 'transparent',
                border: isModalStep ? '3px solid rgba(251, 113, 133, 0.8)' : '2px solid rgba(255, 255, 255, 0.9)',
                pointerEvents: 'none',
                transition: 'all 0.1s ease',
              }}
            />
            {isClickable && !isModalStep && (
              <div
                className="absolute cursor-pointer rounded-xl"
                style={{
                  top: spotlight.top - padding,
                  left: spotlight.left - padding,
                  width: spotlight.width + padding * 2,
                  height: spotlight.height + padding * 2,
                  pointerEvents: 'auto',
                }}
                onClick={() => {
                  const target = document.querySelector(currentStep.waitForClick!);
                  if (target) (target as HTMLElement).click();
                }}
              />
            )}
          </>
        )}

        {spotlight && isVisible && (
          <div
            className="absolute bg-white rounded-xl shadow-2xl p-4 w-[280px] pointer-events-auto"
            style={{
              ...getTooltipStyle(),
              transition: 'all 0.1s ease',
            }}
          >
            <div className="flex items-center justify-between mb-1.5">
              <h3 className="text-sm font-bold text-gray-900">{currentStep.title}</h3>
              <span className="text-xs text-gray-400">{stepIndex + 1}/{steps.length}</span>
            </div>
            <p className="text-xs text-gray-600 leading-relaxed mb-3">{currentStep.content}</p>
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                {!currentStep.isLastStep && (
                  <button onClick={handleSkipAll} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
                    跳过
                  </button>
                )}
                {!isFirstStep && (
                  <button onClick={handlePrev} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
                    上一步
                  </button>
                )}
              </div>
              {!isClickable && (
                <button onClick={() => {
                  if (currentStep.highlight === '[data-tutorial="add-actor-modal"]') {
                    const cancelBtn = document.querySelector('[data-tutorial="cancel-add-actor"]');
                    if (cancelBtn) (cancelBtn as HTMLElement).click();
                  }
                  handleNext();
                }} className="action-btn action-btn-primary text-xs px-3 py-1">
                  {isLastStep ? '开始使用' : currentStep.nextButtonText || '下一步'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {showSkipConfirm && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60">
          <div className="bg-white rounded-2xl shadow-2xl w-[340px] p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-3">确定跳过新手引导？</h3>
            <p className="text-sm text-gray-500 mb-6">
              想再次观看，可以在设置页最下方的「新手引导」重新进入
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowSkipConfirm(false)} className="action-btn text-sm px-4 py-1.5">
                继续引导
              </button>
              <button onClick={confirmSkipAll} className="action-btn action-btn-primary text-sm px-4 py-1.5">
                确定跳过
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const resetOnboarding = () => {
  localStorage.removeItem(ONBOARDING_KEY);
};
