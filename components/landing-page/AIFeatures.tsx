"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

export default function AIFeatures() {
  const pathname = usePathname();
  const isHirePage = pathname.startsWith("/hire");

  const aiFeatures = useMemo(() => {
    if (isHirePage) {
      return [
        {
          title: "AI Smart Search",
          description:
            "Identify top talent without rigid keyword matching. Our semantic engine understands technical nuances, ensuring a search for 'Backend' surfaces 'Node.js' and 'Systems' experts that traditional filters overlook.",
          video:
            "https://vehnycoyrmqdfywybboc.supabase.co/storage/v1/object/public/images/landing_page/videos/ai-smart-search-profiles.mp4",
        },
      ];
    }
    return [
      {
        title: "AI Smart Search",
        description:
          "Move beyond rigid keywords. Our semantic engine understands technical relationships, ensuring a search for 'Frontend' surfaces 'React' and 'Web Engineer' roles that traditional boards miss.",
        video:
          "https://vehnycoyrmqdfywybboc.supabase.co/storage/v1/object/public/images/landing_page/videos/ai-smart-search.mp4",
      },
      {
        title: "AI Global Search",
        description:
          "Find jobs using natural language. Simply type prompts like 'Remote JavaScript roles over $100k' to receive a curated list of high-paying matches in less than two seconds.",
        video:
          "https://vehnycoyrmqdfywybboc.supabase.co/storage/v1/object/public/images/landing_page/videos/ai-global-search.mp4",
      },
      {
        title: "Ask AI",
        description:
          "End writer's block instantly. Generate tailored cover letters and draft compelling answers to complex application questions based on your profile and the specific job requirements.",
        video:
          "https://vehnycoyrmqdfywybboc.supabase.co/storage/v1/object/public/images/landing_page/videos/ask-ai.mp4",
      },
      {
        title: "AI Similar Search",
        description:
          "Found a role that resonates? Use it as a seed to discover 'twin' roles. Our AI analyzes the technical DNA—stack, seniority, and culture—to surface identical opportunities across our database.",
        video:
          "https://vehnycoyrmqdfywybboc.supabase.co/storage/v1/object/public/images/landing_page/videos/ai-similar-search.mp4",
      },
      {
        title: "Job Alerts",
        description:
          "Never miss a match. Get instant notifications for new roles that align with your specific skills and salary expectations, keeping your pipeline full automatically.",
        video:
          "https://vehnycoyrmqdfywybboc.supabase.co/storage/v1/object/public/images/landing_page/videos/Job-alert.mp4",
      },
      {
        title: "AI Summarizer",
        description:
          "Scan 50 jobs in the time it takes to read one. Instantly extract key details like tech stack, salary, and visa sponsorship from messy, long job descriptions.",
        video:
          "https://vehnycoyrmqdfywybboc.supabase.co/storage/v1/object/public/images/landing_page/videos/ai-summarizer.mp4",
      },
    ];
  }, [isHirePage]);

  return (
    <div
      id="aifeatures"
      className="flex flex-col  items-center px-4 py-3 lg:px-20 xl:px-40 2xl:px-80"
    >
      <div className="text-center mb-12">
        <h2 className="text-3xl md:text-4xl font-bold mb-4">Powered by AI</h2>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          {isHirePage
            ? "Connecting you with exceptional, pre-qualified talent with speed and unmatched precision."
            : "Revolutionizing your job search with efficiency and precision."}
        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-6">
        {aiFeatures.map((each) => (
          <FeatureCard
            key={each.title}
            url={each.video}
            title={each.title}
            desc={each.description}
          />
        ))}
      </div>
    </div>
  );
}

const FeatureCard = ({
  url,
  title,
  desc,
}: {
  url: string;
  title: string;
  desc: string;
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  // VIEWPORT LOGIC: Only used to pause if the user leaves the viewport
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          // If the video is playing but leaves the viewport, pause it
          if (!entry.isIntersecting && !video.paused) {
            video.pause();
            setIsPlaying(false);
          }
        });
      },
      { threshold: 0.5 }
    );

    observer.observe(video);

    return () => {
      observer.unobserve(video);
      observer.disconnect();
    };
  }, []);

  const togglePlay = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play().catch(console.error);
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const { currentTime, duration } = videoRef.current;
      if (duration > 0) {
        setProgress((currentTime / duration) * 100);
      }
    }
  };

  return (
    <div className="bg-secondary rounded-xl border-2 border-border shadow-lg">
      <div
        className="aspect-video relative cursor-pointer group"
        onClick={togglePlay}
      >
        <video
          ref={videoRef}
          className="w-full h-full object-cover rounded-t-xl"
          loop
          muted
          playsInline
          poster={"/opengraph-image.jpg"}
          preload="metadata"
          disablePictureInPicture
          controls={false}
          onTimeUpdate={handleTimeUpdate}
        >
          <source src={url} type="video/mp4" />
          Your browser does not support the video tag.
        </video>

        <div
          className={`absolute inset-0 flex items-center justify-center bg-black/10 transition-opacity duration-300 ${
            !isPlaying ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          <div className="h-14 w-14 flex items-center justify-center rounded-full bg-white/20  border border-white/30 text-white shadow-xl transform group-hover:scale-110 transition-transform">
            {isPlaying ? (
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="currentColor"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="currentColor"
                xmlns="http://www.w3.org/2000/svg"
                className="ml-1"
              >
                <path d="M5 3.5L19 12L5 20.5V3.5Z" />
              </svg>
            )}
          </div>
        </div>

        <div className="absolute bottom-0 left-0 w-full h-1 bg-white/20 dark:bg-black/20 overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all duration-100 ease-linear shadow-[0_0_8px_rgba(59,130,246,0.5)]"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
      <div className="p-4 flex flex-col gap-3">
        <div className="text-lg font-bold">{title}</div>
        <p className=""> {desc}</p>
      </div>
    </div>
  );
};
