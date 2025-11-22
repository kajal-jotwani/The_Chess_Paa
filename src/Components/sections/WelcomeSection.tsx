'use client';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import Button from '@/Components/ui/Button';

const WelcomeSection: React.FC = () => {
  return (
    <section className="relative bg-gradient-to-b from-white via-chess-sky/20 to-white py-20 md:py-32 overflow-hidden">

      <div className="relative max-w-7xl mx-auto px-4 md:px-6 lg:px-8">
        <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
          
          {/* Speech bubble - Left side on desktop */}
          <div className="flex-1 order-2 lg:order-1 w-full lg:w-auto">
            <div className="relative">
              {/* Main speech card */}
              <div className="relative bg-white rounded-3xl p-8 md:p-10 shadow-floating border-2 border-chess-sand/50 transform hover:scale-[1.02] transition-transform duration-300">
                {/* Decorative corner accent */}
                <div className="absolute -top-4 -left-4 w-16 h-16 bg-chess-blue rounded-full flex items-center justify-center shadow-card">
                  <span className="text-3xl">👋</span>
                </div>
                
                <p className="text-chess-text text-xl md:text-2xl leading-relaxed font-medium tracking-wide">
                  Hello Hello! I am <span className="font-bold text-2xl md:text-2xl">ChessPaa</span>, your own Chess
                  <span className="font-bold"> Grandpaa</span>. Welcome to my world, where tiny pawns become heroes and every move is a mini–adventure.
                  We'll laugh, learn, and slowly turn you into a clever player and maybe even a <span className="font-bold">GrandMaster</span>.
                  <br />
                  before we start our journey, let's meet your team.
                </p>

                {/* Decorative dots */}
                <div className="flex gap-2 mt-6">
                  <div className="w-3 h-3 rounded-full bg-chess-teal"></div>
                  <div className="w-3 h-3 rounded-full bg-chess-red"></div>
                  <div className="w-3 h-3 rounded-full bg-chess-yellow"></div>
                </div>
              </div>

              <div className="mt-6 flex justify-center lg:justify-middle">
                <Link href="/#pieces">
                  <Button 
                    size="md"
                    variant="primary"
                    className="bg-chess-blue hover:bg-chess-blue/90 text-white shadow-md hover:shadow-lg"
                  >
                    Know Your Pieces
                  </Button>
                </Link>
              </div>
            </div>
          </div>

          <div className="flex-1 lg:flex-none order-1 lg:order-2 flex justify-center lg:justify-end">
            <div className="relative">
              {/* Glow effect behind image */}
              <div className="absolute inset-0 bg-gradient-to-br from-chess-yellow/30 via-chess-teal/20 to-chess-red/30 rounded-full blur-3xl scale-110 -z-10 animate-pulse" />
              
              <div className="relative transform hover:scale-105 transition-transform duration-500">
                <Image
                  src="/ChessPaa.png"
                  alt="ChessPaa Character"
                  width={1000}
                  height={1000}
                  className="w-full max-w-xl md:max-w-3xl lg:max-w-4xl xl:max-w-5xl h-auto drop-shadow-2xl"
                  quality={100}
                  priority
                />
                
                {/* Floating decorative elements */}
                <div className="absolute -top-8 -right-8 w-20 h-20 bg-chess-yellow rounded-full flex items-center justify-center shadow-card animate-bounce">
                  <span className="text-4xl">♟️</span>
                </div>
                <div className="absolute -bottom-8 -left-8 w-16 h-16 bg-chess-red rounded-full flex items-center justify-center shadow-card animate-bounce" style={{ animationDelay: '0.5s' }}>
                  <span className="text-3xl">♔</span>
                </div>

              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default WelcomeSection;