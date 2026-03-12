"use client";

const preventDefaultPropagtion = (
  e: React.MouseEvent<HTMLElement, MouseEvent>,
) => {
  e.nativeEvent.stopImmediatePropagation();
  e.nativeEvent.preventDefault();
  e.preventDefault();
  e.stopPropagation();
};

type PropagationStopperProps = React.HTMLAttributes<HTMLDivElement>;

export default function PropagationStopper({
  children,
  onClick,
  ...props
}: PropagationStopperProps) {
  return (
    <div
      {...props}
      onPointerDown={(e) => {
        preventDefaultPropagtion(e);
      }}
      onMouseDown={(e) => {
        preventDefaultPropagtion(e);
      }}
      onClick={(e) => {
        preventDefaultPropagtion(e);
        if (onClick) onClick(e);
      }}
    >
      {children}
    </div>
  );
}
