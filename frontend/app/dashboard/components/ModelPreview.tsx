'use client';
import { useRef, useEffect, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Environment, Center } from '@react-three/drei';
import * as THREE from 'three';

interface ModelPreviewProps {
  blob: Blob | null;
}

function MeshViewer({ blob }: { blob: Blob }) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const { camera } = useThree();

  useEffect(() => {
    const loadMesh = async () => {
      try {
        // .3mf is a ZIP file containing XML with mesh data
        // For preview, we parse the binary STL-like data from the 3MF
        const { ThreeMFLoader } = await import('three/addons/loaders/3MFLoader.js');
        const loader = new ThreeMFLoader();
        const arrayBuffer = await blob.arrayBuffer();
        const object = loader.parse(arrayBuffer);

        // Extract first mesh geometry from the loaded group
        let geo: THREE.BufferGeometry | null = null;
        object.traverse((child: THREE.Object3D) => {
          if (!geo && child instanceof THREE.Mesh) {
            geo = child.geometry as THREE.BufferGeometry;
          }
        });

        if (geo) {
          geo.computeBoundingSphere();
          if (geo.boundingSphere) {
            const radius = geo.boundingSphere.radius;
            const center = geo.boundingSphere.center;
            (camera as THREE.PerspectiveCamera).position.set(
              center.x + radius * 2,
              center.y + radius * 1.5,
              center.z + radius * 2
            );
            (camera as THREE.PerspectiveCamera).lookAt(center);
          }
          setGeometry(geo);
        }
      } catch (e) {
        console.error('Failed to load 3MF:', e);
      }
    };
    loadMesh();
  }, [blob, camera]);

  if (!geometry) return null;

  return (
    <Center>
      <mesh geometry={geometry}>
        <meshStandardMaterial color="#8b9dc3" roughness={0.4} metalness={0.1} />
      </mesh>
    </Center>
  );
}

export default function ModelPreview({ blob }: ModelPreviewProps) {
  if (!blob) {
    return (
      <div className="w-full h-64 border border-dashed border-border rounded-lg flex items-center justify-center text-sm text-muted-foreground">
        Generate a model to see the 3D preview
      </div>
    );
  }

  return (
    <div className="w-full h-80 border border-border rounded-lg overflow-hidden bg-muted/30">
      <Canvas camera={{ position: [100, 80, 100], fov: 45 }}>
        <ambientLight intensity={0.4} />
        <directionalLight position={[5, 10, 5]} intensity={0.8} />
        <directionalLight position={[-5, 5, -5]} intensity={0.3} />
        <MeshViewer blob={blob} />
        <OrbitControls makeDefault />
        <Environment preset="studio" />
      </Canvas>
    </div>
  );
}
