#!/usr/bin/env python3
"""
Unit Tests for ROI Polygon Ray-Casting Algorithm.
Verifies point-in-polygon math across rectangular, arbitrary, normalized,
and boundary edge cases.
"""
import pytest, os, sys
from collections import namedtuple

Point2D = namedtuple('Point2D', ['x', 'y'])

def is_point_in_polygon(point, polygon):
    if not polygon or len(polygon) < 3:
        return False
    inside = False
    n = len(polygon)
    px, py = point.x, point.y
    p1 = polygon[0]
    for i in range(1, n + 1):
        p2 = polygon[i % n]
        if py > min(p1.y, p2.y) and py <= max(p1.y, p2.y) and px <= max(p1.x, p2.x):
            if p1.y != p2.y:
                xinters = (py - p1.y) * (p2.x - p1.x) / (p2.y - p1.y) + p1.x
            if p1.x == p2.x or px <= xinters:
                inside = not inside
        p1 = p2
    return inside

def test_rectangular_roi_inside():
    rect = [Point2D(0.1, 0.1), Point2D(0.8, 0.1), Point2D(0.8, 0.8), Point2D(0.1, 0.8)]
    inside_point = Point2D(0.5, 0.5)
    assert is_point_in_polygon(inside_point, rect) is True

def test_rectangular_roi_outside():
    rect = [Point2D(0.1, 0.1), Point2D(0.8, 0.1), Point2D(0.8, 0.8), Point2D(0.1, 0.8)]
    outside_point = Point2D(0.05, 0.05)
    assert is_point_in_polygon(outside_point, rect) is False

def test_arbitrary_polygon():
    # L-shaped polygon
    poly = [
        Point2D(0.0, 0.0), Point2D(1.0, 0.0), Point2D(1.0, 0.5),
        Point2D(0.5, 0.5), Point2D(0.5, 1.0), Point2D(0.0, 1.0)
    ]
    assert is_point_in_polygon(Point2D(0.2, 0.2), poly) is True
    assert is_point_in_polygon(Point2D(0.2, 0.8), poly) is True
    assert is_point_in_polygon(Point2D(0.8, 0.8), poly) is False

def test_pixel_coordinates():
    poly = [Point2D(100, 100), Point2D(500, 100), Point2D(500, 400), Point2D(100, 400)]
    assert is_point_in_polygon(Point2D(300, 250), poly) is True
    assert is_point_in_polygon(Point2D(50, 50), poly) is False

def test_empty_or_line_polygon():
    assert is_point_in_polygon(Point2D(0.5, 0.5), []) is False
    assert is_point_in_polygon(Point2D(0.5, 0.5), [Point2D(0, 0), Point2D(1, 1)]) is False
