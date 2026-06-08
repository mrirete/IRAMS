"""
P&ID PDF Pre-processor.
Converts PDF pages to enhanced images for vision analysis.
"""

from __future__ import annotations

import io
import logging
from pathlib import Path
from typing import List

from PIL import Image, ImageEnhance, ImageFilter

logger = logging.getLogger("ers.pid_parser.preprocessor")

# Target DPI for vision extraction
TARGET_DPI = 300


def pdf_to_images(pdf_path: str | Path, dpi: int = TARGET_DPI) -> List[Image.Image]:
    """
    Convert a multi-page PDF into a list of PIL Images.
    Uses pdf2image (poppler backend).
    """
    from pdf2image import convert_from_path

    logger.info("Converting PDF to images at %d DPI: %s", dpi, pdf_path)
    images = convert_from_path(str(pdf_path), dpi=dpi)
    logger.info("Converted %d pages", len(images))
    return images


def enhance_image(img: Image.Image) -> Image.Image:
    """
    Pre-processing pipeline:
      1. Convert to grayscale (P&IDs are line drawings)
      2. Deskew (simple rotation detection placeholder)
      3. Sharpen for line clarity
      4. Enhance contrast for faded drawings
    """
    # 1. Greyscale
    grey = img.convert("L")

    # 2. Deskew (placeholder — full implementation uses Hough transform)
    #    For now, we skip rotation as most digital P&IDs are already aligned

    # 3. Sharpen
    sharpened = grey.filter(ImageFilter.SHARPEN)

    # 4. Contrast boost
    enhancer = ImageEnhance.Contrast(sharpened)
    enhanced = enhancer.enhance(1.5)

    # Convert back to RGB for the vision API
    return enhanced.convert("RGB")


def image_to_base64(img: Image.Image, fmt: str = "PNG") -> str:
    """Encode a PIL Image to a base64 string for API payloads."""
    import base64
    buffer = io.BytesIO()
    img.save(buffer, format=fmt)
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def preprocess_pdf(pdf_path: str | Path) -> List[str]:
    """
    Full pipeline: PDF → pages → enhanced → base64 strings.
    Returns a list of base64-encoded image strings, one per page.
    """
    pages = pdf_to_images(pdf_path)
    results = []
    for i, page in enumerate(pages):
        enhanced = enhance_image(page)
        b64 = image_to_base64(enhanced)
        results.append(b64)
        logger.debug("Page %d pre-processed (%d bytes b64)", i + 1, len(b64))
    return results
