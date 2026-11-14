export interface RawBox { x1: number; y1: number; x2: number; y2: number; conf: number; class: number }

export const CLASS_NAMES = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat', 'traffic light',
  'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat', 'dog', 'horse', 'sheep', 'cow',
  'elephant', 'bear', 'zebra', 'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee',
  'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard',
  'tennis racket', 'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple',
  'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch',
  'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse', 'remote', 'keyboard', 'cell phone',
  'microwave', 'oven', 'toaster', 'sink', 'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear',
  'hair drier', 'toothbrush'
]

export function iou(a: RawBox, b: RawBox): number {
  const x1 = Math.max(a.x1, b.x1)
  const y1 = Math.max(a.y1, b.y1)
  const x2 = Math.min(a.x2, b.x2)
  const y2 = Math.min(a.y2, b.y2)
  if (x2 <= x1 || y2 <= y1) return 0
  const inter = (x2 - x1) * (y2 - y1)
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1)
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1)
  return inter / (areaA + areaB - inter)
}

export function nms(boxes: RawBox[], iouThreshold: number): { class: string; confidence: number; box: { x: number; y: number; width: number; height: number } }[] {
  const sorted = [...boxes].sort((a, b) => b.conf - a.conf)
  const keep: RawBox[] = []
  for (const box of sorted) {
    let suppress = false
    for (const kept of keep) {
      if (iou(box, kept) > iouThreshold) { suppress = true; break }
    }
    if (!suppress) keep.push(box)
  }
  return keep.map(b => ({
    class: CLASS_NAMES[b.class] || `class_${b.class}`,
    confidence: b.conf,
    box: { x: b.x1, y: b.y1, width: b.x2 - b.x1, height: b.y2 - b.y1 }
  }))
}
