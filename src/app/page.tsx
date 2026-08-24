import type { Metadata } from "next";
import ParkClient from "./park/ParkClient";

/**
 * THE FRONT DOOR IS THE PARK.
 *
 * A child who opens this app should step straight through the painted gates
 * into golden-hour dusk — not onto a page about a park. The flat landing page
 * that used to live here is still available at /classic.
 */
export const metadata: Metadata = {
  title: "ChessPaa's Wonderland",
  description:
    "A warm little theme park at golden-hour dusk, where a grandfather named ChessPaa teaches children to play chess.",
};

export default function Home() {
  return <ParkClient />;
}
