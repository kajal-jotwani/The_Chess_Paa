import type { Metadata } from "next";
import ParkClient from "./ParkClient";

export const metadata: Metadata = {
  title: "ChessPaa's Wonderland",
  description: "A warm little theme park where a grandfather teaches you chess.",
};

export default function ParkPage() {
  return <ParkClient />;
}
