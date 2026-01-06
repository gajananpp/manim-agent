import { NextResponse } from 'next/server';
import { readFile, readdir, access, constants } from 'fs/promises';
import { join, resolve } from 'path';
import { existsSync } from 'fs';
import { z } from 'zod';

// Zod schema for video route params
const videoParamsSchema = z.object({
  executionId: z
    .string()
    .min(1, 'Execution ID is required')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Execution ID must contain only alphanumeric characters, hyphens, and underscores'),
  filename: z
    .string()
    .min(1, 'Filename is required')
    .regex(/^[a-zA-Z0-9_.-]+$/, 'Filename must contain only alphanumeric characters, dots, hyphens, and underscores')
    .endsWith('.mp4', 'Filename must end with .mp4'),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ executionId: string; filename: string }> | { executionId: string; filename: string } }
) {
  try {
    // Handle params as Promise (Next.js 15+) or direct object (Next.js 14)
    const resolvedParams = params instanceof Promise ? await params : params;
    
    console.log('Raw params:', resolvedParams);
    
    // Validate params using Zod
    const validationResult = videoParamsSchema.safeParse(resolvedParams);
    
    if (!validationResult.success) {
      const errorTree = z.treeifyError(validationResult.error);
      console.error('Invalid params:', errorTree, 'Received:', resolvedParams);
      return NextResponse.json(
        { 
          error: 'Invalid request parameters',
          details: errorTree,
        },
        { status: 400 }
      );
    }

    const { executionId, filename } = validationResult.data;
    
    console.log('Video request:', { executionId, filename, url: request.url });

    // Construct the base directory for this execution
    const executionDir = join(process.cwd(), 'tmp', 'manim-executions', executionId);
    
    // Check if execution directory exists
    if (!existsSync(executionDir)) {
      return NextResponse.json(
        { error: 'Execution not found' },
        { status: 404 }
      );
    }

    // Search for the video file recursively starting from media/videos
    const mediaDir = join(executionDir, 'media', 'videos');
    
    // Recursive function to find the video file
    const findVideoFile = async (dir: string): Promise<string | null> => {
      try {
        await access(dir, constants.F_OK);
        const entries = await readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          
          if (entry.isDirectory()) {
            const found = await findVideoFile(fullPath);
            if (found) return found;
          } else if (entry.isFile() && entry.name === filename) {
            return fullPath;
          }
        }
      } catch {
        // Directory doesn't exist or can't be accessed
        return null;
      }
      return null;
    };

    const videoPath = await findVideoFile(mediaDir);

    if (!videoPath) {
      return NextResponse.json(
        { error: 'Video file not found' },
        { status: 404 }
      );
    }

    // Verify the path is within the execution directory (security check)
    // Both videoPath and executionDir are already absolute paths
    // Use path.resolve to normalize both paths for comparison (handles symlinks, .., etc.)
    const normalizedVideoPath = resolve(videoPath);
    const normalizedExecutionDir = resolve(executionDir);
    
    if (!normalizedVideoPath.startsWith(normalizedExecutionDir)) {
      console.error('Path validation failed:', {
        videoPath: normalizedVideoPath,
        executionDir: normalizedExecutionDir,
        startsWith: normalizedVideoPath.startsWith(normalizedExecutionDir),
      });
      return NextResponse.json(
        { error: 'Invalid file path' },
        { status: 403 }
      );
    }

    // Read the video file
    const videoBuffer = await readFile(videoPath);

    // Return the video file with appropriate headers
    return new NextResponse(videoBuffer, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': videoBuffer.length.toString(),
        'Cache-Control': 'public, max-age=31536000, immutable', // Cache for 1 year
      },
    });
  } catch (error) {
    console.error('Error serving video file:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

