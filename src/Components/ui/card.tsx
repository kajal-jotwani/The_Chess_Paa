import * as React from "react";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Card({ className = "", ...props }: CardProps) {
  return (
    <div
      {...props}
      className={`rounded-3xl bg-white/95 p-6 shadow-card ring-1 ring-chess-sand/60 backdrop-blur-sm transition-transform duration-200 hover:-translate-y-2 hover:shadow-floating ${className}`}
    />
  );
}
