/**
 * Tests for PostgreSQL-Specific Features That Should Throw Errors
 *
 * PostgREST-Lite targets SQLite compatibility, not PostgreSQL parity.
 * Features that don't translate to SQLite should return clear
 * "Upgrade to PostgREST" errors.
 *
 * Based on SQLITE_COMPATIBLE_ROADMAP.md
 */

import { describe, test, expect } from 'vitest';
import { QueryParser } from '../../src/parser/index.js';
import { UnsupportedFeatureError } from '../../src/errors/index.js';

describe('PostgREST PostgreSQL-Only Features - Should Throw Errors', () => {
  const parser = new QueryParser();

  describe('Full-Text Search Operators', () => {
    test('throws for fts operator', () => {
      expect(() => parser.parse('http://localhost/articles?text=fts.impossible'))
        .toThrow(UnsupportedFeatureError);

      expect(() => parser.parse('http://localhost/articles?text=fts.impossible'))
        .toThrow(/full-text search/i);
    });

    test('throws for plfts operator', () => {
      expect(() => parser.parse('http://localhost/articles?text=plfts.The Fat Rats'))
        .toThrow(UnsupportedFeatureError);

      expect(() => parser.parse('http://localhost/articles?text=plfts.The Fat Rats'))
        .toThrow(/full-text search/i);
    });

    test('throws for phfts operator', () => {
      expect(() => parser.parse('http://localhost/articles?text=phfts.The Fat Cats'))
        .toThrow(UnsupportedFeatureError);

      expect(() => parser.parse('http://localhost/articles?text=phfts.The Fat Cats'))
        .toThrow(/full-text search/i);
    });

    test('throws for wfts operator', () => {
      expect(() => parser.parse('http://localhost/articles?text=wfts.The Fat Rats'))
        .toThrow(UnsupportedFeatureError);

      expect(() => parser.parse('http://localhost/articles?text=wfts.The Fat Rats'))
        .toThrow(/full-text search/i);
    });
  });

  describe('Array/JSON Operators', () => {
    test('throws for cs (contains) operator', () => {
      expect(() => parser.parse('http://localhost/posts?tags=cs.{example,new}'))
        .toThrow(UnsupportedFeatureError);

      expect(() => parser.parse('http://localhost/posts?tags=cs.{example,new}'))
        .toThrow(/array.*contain|contains/i);
    });

    test('throws for cd (contained by) operator', () => {
      expect(() => parser.parse('http://localhost/posts?values=cd.{1,2,3,4,5}'))
        .toThrow(UnsupportedFeatureError);

      expect(() => parser.parse('http://localhost/posts?values=cd.{1,2,3,4,5}'))
        .toThrow(/array.*contained|contained.by/i);
    });

    test('throws for ov (overlaps) operator', () => {
      expect(() => parser.parse('http://localhost/posts?tags=ov.{a,b,c}'))
        .toThrow(UnsupportedFeatureError);

      expect(() => parser.parse('http://localhost/posts?tags=ov.{a,b,c}'))
        .toThrow(/overlaps/i);
    });
  });

  describe('Range Type Operators', () => {
    test('throws for sl (strictly left) operator', () => {
      expect(() => parser.parse('http://localhost/events?range=sl.(1,10)'))
        .toThrow(UnsupportedFeatureError);

      expect(() => parser.parse('http://localhost/events?range=sl.(1,10)'))
        .toThrow(/range.*type|strictly.*left/i);
    });

    test('throws for sr (strictly right) operator', () => {
      expect(() => parser.parse('http://localhost/events?range=sr.(1,10)'))
        .toThrow(UnsupportedFeatureError);

      expect(() => parser.parse('http://localhost/events?range=sr.(1,10)'))
        .toThrow(/range.*type|strictly.*right/i);
    });

    test('throws for nxl (not extend left) operator', () => {
      expect(() => parser.parse('http://localhost/events?range=nxl.(1,10)'))
        .toThrow(UnsupportedFeatureError);

      expect(() => parser.parse('http://localhost/events?range=nxl.(1,10)'))
        .toThrow(/range.*type|not.*extend/i);
    });

    test('throws for nxr (not extend right) operator', () => {
      expect(() => parser.parse('http://localhost/events?range=nxr.(1,10)'))
        .toThrow(UnsupportedFeatureError);

      expect(() => parser.parse('http://localhost/events?range=nxr.(1,10)'))
        .toThrow(/range.*type|not.*extend/i);
    });

    test('throws for adj (adjacent) operator', () => {
      expect(() => parser.parse('http://localhost/events?range=adj.(1,10]'))
        .toThrow(UnsupportedFeatureError);

      expect(() => parser.parse('http://localhost/events?range=adj.(1,10]'))
        .toThrow(/range.*type|adjacent/i);
    });
  });

  describe('Regex Operators', () => {
    test('throws for match operator', () => {
      expect(() => parser.parse('http://localhost/users?text=match.^[A-Z]'))
        .toThrow(UnsupportedFeatureError);

      expect(() => parser.parse('http://localhost/users?text=match.^[A-Z]'))
        .toThrow(/regex/i);
    });

    test('throws for imatch operator', () => {
      expect(() => parser.parse('http://localhost/users?text=imatch.^hello'))
        .toThrow(UnsupportedFeatureError);

      expect(() => parser.parse('http://localhost/users?text=imatch.^hello'))
        .toThrow(/regex/i);
    });
  });

  describe('Special PostgreSQL Operators', () => {
    test('throws for isdistinct operator', () => {
      expect(() => parser.parse('http://localhost/users?id=isdistinct.5'))
        .toThrow(UnsupportedFeatureError);

      expect(() => parser.parse('http://localhost/users?id=isdistinct.5'))
        .toThrow(/is distinct from|isdistinct/i);
    });
  });
});
