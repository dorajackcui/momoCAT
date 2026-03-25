import { describe, test, expect, beforeEach, vi } from 'vitest';
import { TagManager } from './TagManager';
import type { Token } from './models';

describe('TagManager', () => {
  let tagManager: TagManager;

  beforeEach(() => {
    tagManager = new TagManager();
  });

  describe('Event Emitter Pattern', () => {
    test('registers event handlers with on()', () => {
      const handler = vi.fn();
      
      tagManager.on('testEvent', handler);
      tagManager.emit('testEvent', { data: 'test' });
      
      expect(handler).toHaveBeenCalledWith({ data: 'test' });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    test('supports multiple handlers for the same event', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      
      tagManager.on('testEvent', handler1);
      tagManager.on('testEvent', handler2);
      tagManager.emit('testEvent', { data: 'test' });
      
      expect(handler1).toHaveBeenCalledWith({ data: 'test' });
      expect(handler2).toHaveBeenCalledWith({ data: 'test' });
    });

    test('emits events only to registered handlers', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      
      tagManager.on('event1', handler1);
      tagManager.on('event2', handler2);
      tagManager.emit('event1', { data: 'test1' });
      
      expect(handler1).toHaveBeenCalledWith({ data: 'test1' });
      expect(handler2).not.toHaveBeenCalled();
    });

    test('handles emit with no registered handlers', () => {
      // Should not throw an error
      expect(() => {
        tagManager.emit('nonExistentEvent', { data: 'test' });
      }).not.toThrow();
    });

    test('passes correct data to event handlers', () => {
      const handler = vi.fn();
      const testTag: Token = {
        type: 'tag',
        content: '<bold>',
        meta: { id: '<bold>' }
      };
      
      tagManager.on('tagInserted', handler);
      tagManager.emit('tagInserted', { tagIndex: 2, tag: testTag });
      
      expect(handler).toHaveBeenCalledWith({
        tagIndex: 2,
        tag: testTag
      });
    });

    test('supports multiple event types', () => {
      const insertHandler = vi.fn();
      const deleteHandler = vi.fn();
      const moveHandler = vi.fn();
      
      tagManager.on('tagInserted', insertHandler);
      tagManager.on('tagDeleted', deleteHandler);
      tagManager.on('tagMoved', moveHandler);
      
      tagManager.emit('tagInserted', { tagIndex: 0, tag: {} });
      tagManager.emit('tagDeleted', { tagIndex: 1 });
      tagManager.emit('tagMoved', { fromIndex: 0, toPosition: 2 });
      
      expect(insertHandler).toHaveBeenCalledTimes(1);
      expect(deleteHandler).toHaveBeenCalledTimes(1);
      expect(moveHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Tag Insertion', () => {
    describe('insertTag()', () => {
      test('inserts tag at the beginning of text', () => {
        const tokens: Token[] = [
          { type: 'text', content: 'Hello world' }
        ];
        
        const result = tagManager.insertTag(tokens, '<bold>', 0);
        
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({
          type: 'tag',
          content: '<bold>',
          meta: { id: '<bold>' }
        });
        expect(result[1]).toEqual({ type: 'text', content: 'Hello world' });
      });

      test('inserts tag at the end of text', () => {
        const tokens: Token[] = [
          { type: 'text', content: 'Hello world' }
        ];
        
        const result = tagManager.insertTag(tokens, '<bold>', 11);
        
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ type: 'text', content: 'Hello world' });
        expect(result[1]).toEqual({
          type: 'tag',
          content: '<bold>',
          meta: { id: '<bold>' }
        });
      });

      test('inserts tag in the middle of text, splitting the token', () => {
        const tokens: Token[] = [
          { type: 'text', content: 'Hello world' }
        ];
        
        const result = tagManager.insertTag(tokens, '<bold>', 6);
        
        expect(result).toHaveLength(3);
        expect(result[0]).toEqual({ type: 'text', content: 'Hello ' });
        expect(result[1]).toEqual({
          type: 'tag',
          content: '<bold>',
          meta: { id: '<bold>' }
        });
        expect(result[2]).toEqual({ type: 'text', content: 'world' });
      });

      test('inserts tag between existing tokens', () => {
        const tokens: Token[] = [
          { type: 'text', content: 'Hello ' },
          { type: 'text', content: 'world' }
        ];
        
        const result = tagManager.insertTag(tokens, '<bold>', 6);
        
        expect(result).toHaveLength(3);
        expect(result[0]).toEqual({ type: 'text', content: 'Hello ' });
        expect(result[1]).toEqual({
          type: 'tag',
          content: '<bold>',
          meta: { id: '<bold>' }
        });
        expect(result[2]).toEqual({ type: 'text', content: 'world' });
      });

      test('inserts tag after existing tag', () => {
        const tokens: Token[] = [
          { type: 'text', content: 'Hello ' },
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'world' }
        ];
        
        const result = tagManager.insertTag(tokens, '</bold>', 6);
        
        expect(result).toHaveLength(4);
        expect(result[0]).toEqual({ type: 'text', content: 'Hello ' });
        expect(result[1]).toEqual({ type: 'tag', content: '<bold>' });
        expect(result[2]).toEqual({
          type: 'tag',
          content: '</bold>',
          meta: { id: '</bold>' }
        });
        expect(result[3]).toEqual({ type: 'text', content: 'world' });
      });

      test('inserts placeholder tag', () => {
        const tokens: Token[] = [
          { type: 'text', content: 'Value: ' }
        ];
        
        const result = tagManager.insertTag(tokens, '{1}', 7);
        
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ type: 'text', content: 'Value: ' });
        expect(result[1]).toEqual({
          type: 'tag',
          content: '{1}',
          meta: { id: '{1}' }
        });
      });

      test('inserts printf-style tag', () => {
        const tokens: Token[] = [
          { type: 'text', content: 'Count: ' }
        ];
        
        const result = tagManager.insertTag(tokens, '%d', 7);
        
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ type: 'text', content: 'Count: ' });
        expect(result[1]).toEqual({
          type: 'tag',
          content: '%d',
          meta: { id: '%d' }
        });
      });

      test('emits tagInserted event with correct data', () => {
        const handler = vi.fn();
        tagManager.on('tagInserted', handler);
        
        const tokens: Token[] = [
          { type: 'text', content: 'Hello world' }
        ];
        
        tagManager.insertTag(tokens, '<bold>', 6);
        
        expect(handler).toHaveBeenCalledWith({
          tagIndex: 1,
          tag: {
            type: 'tag',
            content: '<bold>',
            meta: { id: '<bold>' }
          }
        });
      });

      test('handles empty token array', () => {
        const tokens: Token[] = [];
        
        const result = tagManager.insertTag(tokens, '<bold>', 0);
        
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
          type: 'tag',
          content: '<bold>',
          meta: { id: '<bold>' }
        });
      });

      test('handles cursor position beyond text length', () => {
        const tokens: Token[] = [
          { type: 'text', content: 'Hello' }
        ];
        
        const result = tagManager.insertTag(tokens, '<bold>', 100);
        
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ type: 'text', content: 'Hello' });
        expect(result[1]).toEqual({
          type: 'tag',
          content: '<bold>',
          meta: { id: '<bold>' }
        });
      });

      test('does not modify original token array', () => {
        const tokens: Token[] = [
          { type: 'text', content: 'Hello world' }
        ];
        const originalLength = tokens.length;
        
        tagManager.insertTag(tokens, '<bold>', 6);
        
        expect(tokens).toHaveLength(originalLength);
        expect(tokens[0]).toEqual({ type: 'text', content: 'Hello world' });
      });
    });

    describe('insertAllTags()', () => {
      test('inserts all tags at cursor position', () => {
        const targetTokens: Token[] = [
          { type: 'text', content: 'Bonjour monde' }
        ];
        const sourceTags: Token[] = [
          { type: 'tag', content: '<bold>' },
          { type: 'tag', content: '</bold>' }
        ];
        
        const result = tagManager.insertAllTags(targetTokens, sourceTags, 8);
        
        expect(result).toHaveLength(4);
        expect(result[0]).toEqual({ type: 'text', content: 'Bonjour ' });
        expect(result[1]).toEqual({
          type: 'tag',
          content: '<bold>',
          meta: { id: '<bold>' }
        });
        expect(result[2]).toEqual({
          type: 'tag',
          content: '</bold>',
          meta: { id: '</bold>' }
        });
        expect(result[3]).toEqual({ type: 'text', content: 'monde' });
      });

      test('inserts all tags at the beginning', () => {
        const targetTokens: Token[] = [
          { type: 'text', content: 'Hello world' }
        ];
        const sourceTags: Token[] = [
          { type: 'tag', content: '<bold>' },
          { type: 'tag', content: '<italic>' }
        ];
        
        const result = tagManager.insertAllTags(targetTokens, sourceTags, 0);
        
        expect(result).toHaveLength(3);
        expect(result[0]).toEqual({
          type: 'tag',
          content: '<bold>',
          meta: { id: '<bold>' }
        });
        expect(result[1]).toEqual({
          type: 'tag',
          content: '<italic>',
          meta: { id: '<italic>' }
        });
        expect(result[2]).toEqual({ type: 'text', content: 'Hello world' });
      });

      test('inserts all tags at the end', () => {
        const targetTokens: Token[] = [
          { type: 'text', content: 'Hello world' }
        ];
        const sourceTags: Token[] = [
          { type: 'tag', content: '</bold>' },
          { type: 'tag', content: '</italic>' }
        ];
        
        const result = tagManager.insertAllTags(targetTokens, sourceTags, 11);
        
        expect(result).toHaveLength(3);
        expect(result[0]).toEqual({ type: 'text', content: 'Hello world' });
        expect(result[1]).toEqual({
          type: 'tag',
          content: '</bold>',
          meta: { id: '</bold>' }
        });
        expect(result[2]).toEqual({
          type: 'tag',
          content: '</italic>',
          meta: { id: '</italic>' }
        });
      });

      test('preserves tag order from source', () => {
        const targetTokens: Token[] = [
          { type: 'text', content: 'Text' }
        ];
        const sourceTags: Token[] = [
          { type: 'tag', content: '{1}' },
          { type: 'tag', content: '{2}' },
          { type: 'tag', content: '{3}' }
        ];
        
        const result = tagManager.insertAllTags(targetTokens, sourceTags, 2);
        
        expect(result).toHaveLength(5);
        expect(result[0]).toEqual({ type: 'text', content: 'Te' });
        expect(result[1].content).toBe('{1}');
        expect(result[2].content).toBe('{2}');
        expect(result[3].content).toBe('{3}');
        expect(result[4]).toEqual({ type: 'text', content: 'xt' });
      });

      test('handles empty source tags array', () => {
        const targetTokens: Token[] = [
          { type: 'text', content: 'Hello world' }
        ];
        const sourceTags: Token[] = [];
        
        const result = tagManager.insertAllTags(targetTokens, sourceTags, 6);
        
        expect(result).toHaveLength(1);
        expect(result).toEqual(targetTokens);
      });

      test('handles single tag', () => {
        const targetTokens: Token[] = [
          { type: 'text', content: 'Hello world' }
        ];
        const sourceTags: Token[] = [
          { type: 'tag', content: '<br/>' }
        ];
        
        const result = tagManager.insertAllTags(targetTokens, sourceTags, 6);
        
        expect(result).toHaveLength(3);
        expect(result[0]).toEqual({ type: 'text', content: 'Hello ' });
        expect(result[1]).toEqual({
          type: 'tag',
          content: '<br/>',
          meta: { id: '<br/>' }
        });
        expect(result[2]).toEqual({ type: 'text', content: 'world' });
      });

      test('emits tagInserted event for each tag', () => {
        const handler = vi.fn();
        tagManager.on('tagInserted', handler);
        
        const targetTokens: Token[] = [
          { type: 'text', content: 'Hello world' }
        ];
        const sourceTags: Token[] = [
          { type: 'tag', content: '<bold>' },
          { type: 'tag', content: '</bold>' }
        ];
        
        tagManager.insertAllTags(targetTokens, sourceTags, 6);
        
        expect(handler).toHaveBeenCalledTimes(2);
      });

      test('inserts mixed tag types', () => {
        const targetTokens: Token[] = [
          { type: 'text', content: 'Value: ' }
        ];
        const sourceTags: Token[] = [
          { type: 'tag', content: '<bold>' },
          { type: 'tag', content: '{1}' },
          { type: 'tag', content: '</bold>' },
          { type: 'tag', content: '%s' }
        ];
        
        const result = tagManager.insertAllTags(targetTokens, sourceTags, 7);
        
        expect(result).toHaveLength(5);
        expect(result[0]).toEqual({ type: 'text', content: 'Value: ' });
        expect(result[1].content).toBe('<bold>');
        expect(result[2].content).toBe('{1}');
        expect(result[3].content).toBe('</bold>');
        expect(result[4].content).toBe('%s');
      });

      test('does not modify original arrays', () => {
        const targetTokens: Token[] = [
          { type: 'text', content: 'Hello world' }
        ];
        const sourceTags: Token[] = [
          { type: 'tag', content: '<bold>' }
        ];
        const originalTargetLength = targetTokens.length;
        const originalSourceLength = sourceTags.length;
        
        tagManager.insertAllTags(targetTokens, sourceTags, 6);
        
        expect(targetTokens).toHaveLength(originalTargetLength);
        expect(sourceTags).toHaveLength(originalSourceLength);
      });
    });
  });

  describe('Tag Deletion', () => {
    describe('deleteTag()', () => {
      test('deletes tag at specified index', () => {
        const tokens: Token[] = [
          { type: 'text', content: 'Hello ' },
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'world' }
        ];
        
        const result = tagManager.deleteTag(tokens, 1);
        
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ type: 'text', content: 'Hello ' });
        expect(result[1]).toEqual({ type: 'text', content: 'world' });
        expect(result.find(t => t.type === 'tag')).toBeUndefined();
      });

      test('deletes tag at the beginning', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'Hello world' }
        ];
        
        const result = tagManager.deleteTag(tokens, 0);
        
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({ type: 'text', content: 'Hello world' });
      });

      test('deletes tag at the end', () => {
        const tokens: Token[] = [
          { type: 'text', content: 'Hello world' },
          { type: 'tag', content: '</bold>' }
        ];
        
        const result = tagManager.deleteTag(tokens, 1);
        
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({ type: 'text', content: 'Hello world' });
      });

      test('deletes tag from multiple tags', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'Hello' },
          { type: 'tag', content: '</bold>' },
          { type: 'text', content: ' ' },
          { type: 'tag', content: '<italic>' },
          { type: 'text', content: 'world' },
          { type: 'tag', content: '</italic>' }
        ];
        
        const result = tagManager.deleteTag(tokens, 2);
        
        expect(result).toHaveLength(6);
        expect(result[0]).toEqual({ type: 'tag', content: '<bold>' });
        expect(result[1]).toEqual({ type: 'text', content: 'Hello' });
        expect(result[2]).toEqual({ type: 'text', content: ' ' });
        expect(result[3]).toEqual({ type: 'tag', content: '<italic>' });
        expect(result[4]).toEqual({ type: 'text', content: 'world' });
        expect(result[5]).toEqual({ type: 'tag', content: '</italic>' });
      });

      test('deletes standalone tag', () => {
        const tokens: Token[] = [
          { type: 'text', content: 'Value: ' },
          { type: 'tag', content: '{1}' },
          { type: 'text', content: ' here' }
        ];
        
        const result = tagManager.deleteTag(tokens, 1);
        
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ type: 'text', content: 'Value: ' });
        expect(result[1]).toEqual({ type: 'text', content: ' here' });
      });

      test('deletes paired opening tag', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'Hello' },
          { type: 'tag', content: '</bold>' }
        ];
        
        const result = tagManager.deleteTag(tokens, 0);
        
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ type: 'text', content: 'Hello' });
        expect(result[1]).toEqual({ type: 'tag', content: '</bold>' });
      });

      test('deletes paired closing tag', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'Hello' },
          { type: 'tag', content: '</bold>' }
        ];
        
        const result = tagManager.deleteTag(tokens, 2);
        
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ type: 'tag', content: '<bold>' });
        expect(result[1]).toEqual({ type: 'text', content: 'Hello' });
      });

      test('emits tagDeleted event with correct data', () => {
        const handler = vi.fn();
        tagManager.on('tagDeleted', handler);
        
        const tokens: Token[] = [
          { type: 'text', content: 'Hello ' },
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'world' }
        ];
        
        tagManager.deleteTag(tokens, 1);
        
        expect(handler).toHaveBeenCalledWith({ tagIndex: 1 });
        expect(handler).toHaveBeenCalledTimes(1);
      });

      test('handles invalid index (negative)', () => {
        const tokens: Token[] = [
          { type: 'text', content: 'Hello ' },
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'world' }
        ];
        
        const result = tagManager.deleteTag(tokens, -1);
        
        // Should return unchanged tokens
        expect(result).toEqual(tokens);
        expect(result).toHaveLength(3);
      });

      test('handles invalid index (out of bounds)', () => {
        const tokens: Token[] = [
          { type: 'text', content: 'Hello ' },
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'world' }
        ];
        
        const result = tagManager.deleteTag(tokens, 10);
        
        // Should return unchanged tokens
        expect(result).toEqual(tokens);
        expect(result).toHaveLength(3);
      });

      test('handles attempt to delete non-tag token', () => {
        const tokens: Token[] = [
          { type: 'text', content: 'Hello ' },
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'world' }
        ];
        
        const result = tagManager.deleteTag(tokens, 0);
        
        // Should return unchanged tokens since index 0 is text, not tag
        expect(result).toEqual(tokens);
        expect(result).toHaveLength(3);
      });

      test('does not emit event when deletion fails', () => {
        const handler = vi.fn();
        tagManager.on('tagDeleted', handler);
        
        const tokens: Token[] = [
          { type: 'text', content: 'Hello world' }
        ];
        
        // Try to delete at invalid index
        tagManager.deleteTag(tokens, 10);
        
        expect(handler).not.toHaveBeenCalled();
      });

      test('does not emit event when trying to delete non-tag', () => {
        const handler = vi.fn();
        tagManager.on('tagDeleted', handler);
        
        const tokens: Token[] = [
          { type: 'text', content: 'Hello world' }
        ];
        
        // Try to delete text token
        tagManager.deleteTag(tokens, 0);
        
        expect(handler).not.toHaveBeenCalled();
      });

      test('does not modify original token array', () => {
        const tokens: Token[] = [
          { type: 'text', content: 'Hello ' },
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'world' }
        ];
        const originalLength = tokens.length;
        const originalContent = tokens[1].content;
        
        tagManager.deleteTag(tokens, 1);
        
        expect(tokens).toHaveLength(originalLength);
        expect(tokens[1].content).toBe(originalContent);
      });

      test('handles deleting only tag in array', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<bold>' }
        ];
        
        const result = tagManager.deleteTag(tokens, 0);
        
        expect(result).toHaveLength(0);
        expect(result).toEqual([]);
      });

      test('handles consecutive tag deletions', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<bold>' },
          { type: 'tag', content: '<italic>' },
          { type: 'text', content: 'Hello' },
          { type: 'tag', content: '</italic>' },
          { type: 'tag', content: '</bold>' }
        ];
        
        // Delete first tag
        let result = tagManager.deleteTag(tokens, 0);
        expect(result).toHaveLength(4);
        
        // Delete what is now the first tag (was second)
        result = tagManager.deleteTag(result, 0);
        expect(result).toHaveLength(3);
        expect(result[0]).toEqual({ type: 'text', content: 'Hello' });
      });

      test('maintains surrounding token integrity after deletion', () => {
        const tokens: Token[] = [
          { type: 'text', content: 'Before ' },
          { type: 'tag', content: '{1}' },
          { type: 'text', content: ' after' }
        ];
        
        const result = tagManager.deleteTag(tokens, 1);
        
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ type: 'text', content: 'Before ' });
        expect(result[1]).toEqual({ type: 'text', content: ' after' });
        // Note: Text tokens are not merged - that's expected behavior
      });
    });
  });

  describe('Tag Movement', () => {
    describe('moveTag()', () => {
      test('moves tag forward in token array', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'Hello' },
          { type: 'tag', content: '</bold>' },
          { type: 'text', content: ' world' }
        ];
        
        const result = tagManager.moveTag(tokens, 0, 2);
        
        expect(result).toHaveLength(4);
        expect(result[0]).toEqual({ type: 'text', content: 'Hello' });
        expect(result[1]).toEqual({ type: 'tag', content: '<bold>' });
        expect(result[2]).toEqual({ type: 'tag', content: '</bold>' });
        expect(result[3]).toEqual({ type: 'text', content: ' world' });
      });

      test('moves tag backward in token array', () => {
        const tokens: Token[] = [
          { type: 'text', content: 'Hello ' },
          { type: 'text', content: 'world' },
          { type: 'tag', content: '<bold>' }
        ];
        
        const result = tagManager.moveTag(tokens, 2, 0);
        
        expect(result).toHaveLength(3);
        expect(result[0]).toEqual({ type: 'tag', content: '<bold>' });
        expect(result[1]).toEqual({ type: 'text', content: 'Hello ' });
        expect(result[2]).toEqual({ type: 'text', content: 'world' });
      });

      test('moves tag to adjacent position', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<bold>' },
          { type: 'tag', content: '<italic>' },
          { type: 'text', content: 'Hello' }
        ];
        
        const result = tagManager.moveTag(tokens, 0, 1);
        
        expect(result).toHaveLength(3);
        expect(result[0]).toEqual({ type: 'tag', content: '<italic>' });
        expect(result[1]).toEqual({ type: 'tag', content: '<bold>' });
        expect(result[2]).toEqual({ type: 'text', content: 'Hello' });
      });

      test('moves tag to end of array', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '{1}' },
          { type: 'text', content: 'Hello' },
          { type: 'text', content: ' world' }
        ];
        
        const result = tagManager.moveTag(tokens, 0, 2);
        
        expect(result).toHaveLength(3);
        expect(result[0]).toEqual({ type: 'text', content: 'Hello' });
        expect(result[1]).toEqual({ type: 'tag', content: '{1}' });
        expect(result[2]).toEqual({ type: 'text', content: ' world' });
      });

      test('moves tag from end to beginning', () => {
        const tokens: Token[] = [
          { type: 'text', content: 'Hello' },
          { type: 'text', content: ' world' },
          { type: 'tag', content: '{1}' }
        ];
        
        const result = tagManager.moveTag(tokens, 2, 0);
        
        expect(result).toHaveLength(3);
        expect(result[0]).toEqual({ type: 'tag', content: '{1}' });
        expect(result[1]).toEqual({ type: 'text', content: 'Hello' });
        expect(result[2]).toEqual({ type: 'text', content: ' world' });
      });

      test('moves tag among multiple tags', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '{1}' },
          { type: 'tag', content: '{2}' },
          { type: 'tag', content: '{3}' },
          { type: 'text', content: 'Text' }
        ];
        
        const result = tagManager.moveTag(tokens, 0, 2);
        
        expect(result).toHaveLength(4);
        expect(result[0]).toEqual({ type: 'tag', content: '{2}' });
        expect(result[1]).toEqual({ type: 'tag', content: '{1}' });
        expect(result[2]).toEqual({ type: 'tag', content: '{3}' });
        expect(result[3]).toEqual({ type: 'text', content: 'Text' });
      });

      test('moves paired opening tag', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'Hello' },
          { type: 'tag', content: '</bold>' },
          { type: 'text', content: ' world' }
        ];
        
        const result = tagManager.moveTag(tokens, 0, 3);
        
        expect(result).toHaveLength(4);
        expect(result[0]).toEqual({ type: 'text', content: 'Hello' });
        expect(result[1]).toEqual({ type: 'tag', content: '</bold>' });
        expect(result[2]).toEqual({ type: 'tag', content: '<bold>' });
        expect(result[3]).toEqual({ type: 'text', content: ' world' });
      });

      test('moves paired closing tag', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'Hello' },
          { type: 'tag', content: '</bold>' },
          { type: 'text', content: ' world' }
        ];
        
        const result = tagManager.moveTag(tokens, 2, 0);
        
        expect(result).toHaveLength(4);
        expect(result[0]).toEqual({ type: 'tag', content: '</bold>' });
        expect(result[1]).toEqual({ type: 'tag', content: '<bold>' });
        expect(result[2]).toEqual({ type: 'text', content: 'Hello' });
        expect(result[3]).toEqual({ type: 'text', content: ' world' });
      });

      test('moves standalone tag', () => {
        const tokens: Token[] = [
          { type: 'text', content: 'Value: ' },
          { type: 'tag', content: '{1}' },
          { type: 'text', content: ' here' }
        ];
        
        const result = tagManager.moveTag(tokens, 1, 2);
        
        expect(result).toHaveLength(3);
        expect(result[0]).toEqual({ type: 'text', content: 'Value: ' });
        expect(result[1]).toEqual({ type: 'text', content: ' here' });
        expect(result[2]).toEqual({ type: 'tag', content: '{1}' });
      });

      test('emits tagMoved event with correct data', () => {
        const handler = vi.fn();
        tagManager.on('tagMoved', handler);
        
        const tokens: Token[] = [
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'Hello' },
          { type: 'tag', content: '</bold>' }
        ];
        
        tagManager.moveTag(tokens, 0, 2);
        
        expect(handler).toHaveBeenCalledWith({
          fromIndex: 0,
          toPosition: 2
        });
        expect(handler).toHaveBeenCalledTimes(1);
      });

      test('handles same fromIndex and toPosition (no-op)', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'Hello' },
          { type: 'tag', content: '</bold>' }
        ];
        
        const result = tagManager.moveTag(tokens, 0, 0);
        
        // Should return unchanged tokens
        expect(result).toEqual(tokens);
        expect(result).toHaveLength(3);
      });

      test('handles invalid fromIndex (negative)', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'Hello' }
        ];
        
        const result = tagManager.moveTag(tokens, -1, 1);
        
        // Should return unchanged tokens
        expect(result).toEqual(tokens);
        expect(result).toHaveLength(2);
      });

      test('handles invalid fromIndex (out of bounds)', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'Hello' }
        ];
        
        const result = tagManager.moveTag(tokens, 10, 1);
        
        // Should return unchanged tokens
        expect(result).toEqual(tokens);
        expect(result).toHaveLength(2);
      });

      test('handles invalid toPosition (negative)', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'Hello' }
        ];
        
        const result = tagManager.moveTag(tokens, 0, -1);
        
        // Should return unchanged tokens
        expect(result).toEqual(tokens);
        expect(result).toHaveLength(2);
      });

      test('handles invalid toPosition (out of bounds)', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'Hello' }
        ];
        
        const result = tagManager.moveTag(tokens, 0, 10);
        
        // Should return unchanged tokens
        expect(result).toEqual(tokens);
        expect(result).toHaveLength(2);
      });

      test('handles attempt to move non-tag token', () => {
        const tokens: Token[] = [
          { type: 'text', content: 'Hello' },
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'world' }
        ];
        
        const result = tagManager.moveTag(tokens, 0, 2);
        
        // Should return unchanged tokens since index 0 is text, not tag
        expect(result).toEqual(tokens);
        expect(result).toHaveLength(3);
      });

      test('does not emit event when move fails due to invalid fromIndex', () => {
        const handler = vi.fn();
        tagManager.on('tagMoved', handler);
        
        const tokens: Token[] = [
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'Hello' }
        ];
        
        // Try to move from invalid index
        tagManager.moveTag(tokens, 10, 1);
        
        expect(handler).not.toHaveBeenCalled();
      });

      test('does not emit event when move fails due to invalid toPosition', () => {
        const handler = vi.fn();
        tagManager.on('tagMoved', handler);
        
        const tokens: Token[] = [
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'Hello' }
        ];
        
        // Try to move to invalid position
        tagManager.moveTag(tokens, 0, 10);
        
        expect(handler).not.toHaveBeenCalled();
      });

      test('does not emit event when trying to move non-tag', () => {
        const handler = vi.fn();
        tagManager.on('tagMoved', handler);
        
        const tokens: Token[] = [
          { type: 'text', content: 'Hello' },
          { type: 'tag', content: '<bold>' }
        ];
        
        // Try to move text token
        tagManager.moveTag(tokens, 0, 1);
        
        expect(handler).not.toHaveBeenCalled();
      });

      test('does not modify original token array', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'Hello' },
          { type: 'tag', content: '</bold>' }
        ];
        const originalLength = tokens.length;
        const originalFirstTag = tokens[0].content;
        
        tagManager.moveTag(tokens, 0, 2);
        
        expect(tokens).toHaveLength(originalLength);
        expect(tokens[0].content).toBe(originalFirstTag);
      });

      test('maintains all tokens after move', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '{1}' },
          { type: 'tag', content: '{2}' },
          { type: 'tag', content: '{3}' }
        ];
        
        const result = tagManager.moveTag(tokens, 0, 2);
        
        // All tags should still be present
        expect(result).toHaveLength(3);
        expect(result.filter(t => t.type === 'tag')).toHaveLength(3);
        expect(result.map(t => t.content).sort()).toEqual(['{1}', '{2}', '{3}']);
      });

      test('preserves relative order of non-moved tokens', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '{1}' },
          { type: 'text', content: 'A' },
          { type: 'text', content: 'B' },
          { type: 'tag', content: '{2}' }
        ];
        
        const result = tagManager.moveTag(tokens, 0, 3);
        
        // Text tokens should maintain their relative order
        expect(result[0]).toEqual({ type: 'text', content: 'A' });
        expect(result[1]).toEqual({ type: 'text', content: 'B' });
        expect(result[2]).toEqual({ type: 'tag', content: '{1}' });
        expect(result[3]).toEqual({ type: 'tag', content: '{2}' });
      });

      test('handles complex token sequence', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'Hello' },
          { type: 'tag', content: '</bold>' },
          { type: 'text', content: ' ' },
          { type: 'tag', content: '<italic>' },
          { type: 'text', content: 'world' },
          { type: 'tag', content: '</italic>' }
        ];
        
        // Move </bold> to after </italic>
        const result = tagManager.moveTag(tokens, 2, 6);
        
        expect(result).toHaveLength(7);
        expect(result[0]).toEqual({ type: 'tag', content: '<bold>' });
        expect(result[1]).toEqual({ type: 'text', content: 'Hello' });
        expect(result[2]).toEqual({ type: 'text', content: ' ' });
        expect(result[3]).toEqual({ type: 'tag', content: '<italic>' });
        expect(result[4]).toEqual({ type: 'text', content: 'world' });
        expect(result[5]).toEqual({ type: 'tag', content: '</bold>' });
        expect(result[6]).toEqual({ type: 'tag', content: '</italic>' });
      });
    });
  });

  describe('Tag Pairing', () => {
    describe('findPairedTag()', () => {
      test('finds closing tag for opening tag', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'Hello' },
          { type: 'tag', content: '</bold>' }
        ];
        
        const pairedIndex = tagManager.findPairedTag(tokens, 0);
        
        expect(pairedIndex).toBe(2);
      });

      test('finds opening tag for closing tag', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'Hello' },
          { type: 'tag', content: '</bold>' }
        ];
        
        const pairedIndex = tagManager.findPairedTag(tokens, 2);
        
        expect(pairedIndex).toBe(0);
      });

      test('returns undefined for standalone placeholder tag', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '{1}' },
          { type: 'text', content: 'Hello' }
        ];
        
        const pairedIndex = tagManager.findPairedTag(tokens, 0);
        
        expect(pairedIndex).toBeUndefined();
      });

      test('returns undefined for standalone self-closing tag', () => {
        const tokens: Token[] = [
          { type: 'text', content: 'Line 1' },
          { type: 'tag', content: '<br/>' },
          { type: 'text', content: 'Line 2' }
        ];
        
        const pairedIndex = tagManager.findPairedTag(tokens, 1);
        
        expect(pairedIndex).toBeUndefined();
      });

      test('returns undefined for standalone printf-style tag', () => {
        const tokens: Token[] = [
          { type: 'text', content: 'Count: ' },
          { type: 'tag', content: '%d' },
          { type: 'text', content: ' items' }
        ];
        
        const pairedIndex = tagManager.findPairedTag(tokens, 1);
        
        expect(pairedIndex).toBeUndefined();
      });

      test('handles nested tags correctly - finds outer closing tag', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<b>' },
          { type: 'tag', content: '<i>' },
          { type: 'text', content: 'text' },
          { type: 'tag', content: '</i>' },
          { type: 'tag', content: '</b>' }
        ];
        
        const pairedIndex = tagManager.findPairedTag(tokens, 0);
        
        expect(pairedIndex).toBe(4);
      });

      test('handles nested tags correctly - finds inner closing tag', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<b>' },
          { type: 'tag', content: '<i>' },
          { type: 'text', content: 'text' },
          { type: 'tag', content: '</i>' },
          { type: 'tag', content: '</b>' }
        ];
        
        const pairedIndex = tagManager.findPairedTag(tokens, 1);
        
        expect(pairedIndex).toBe(3);
      });

      test('handles nested tags correctly - finds outer opening tag from closing', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<b>' },
          { type: 'tag', content: '<i>' },
          { type: 'text', content: 'text' },
          { type: 'tag', content: '</i>' },
          { type: 'tag', content: '</b>' }
        ];
        
        const pairedIndex = tagManager.findPairedTag(tokens, 4);
        
        expect(pairedIndex).toBe(0);
      });

      test('handles nested tags correctly - finds inner opening tag from closing', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<b>' },
          { type: 'tag', content: '<i>' },
          { type: 'text', content: 'text' },
          { type: 'tag', content: '</i>' },
          { type: 'tag', content: '</b>' }
        ];
        
        const pairedIndex = tagManager.findPairedTag(tokens, 3);
        
        expect(pairedIndex).toBe(1);
      });

      test('handles deeply nested same-name tags', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<div>' },
          { type: 'tag', content: '<div>' },
          { type: 'tag', content: '<div>' },
          { type: 'text', content: 'content' },
          { type: 'tag', content: '</div>' },
          { type: 'tag', content: '</div>' },
          { type: 'tag', content: '</div>' }
        ];
        
        // Outermost opening tag should pair with outermost closing tag
        const outerPair = tagManager.findPairedTag(tokens, 0);
        expect(outerPair).toBe(6);
        
        // Middle opening tag should pair with middle closing tag
        const middlePair = tagManager.findPairedTag(tokens, 1);
        expect(middlePair).toBe(5);
        
        // Innermost opening tag should pair with innermost closing tag
        const innerPair = tagManager.findPairedTag(tokens, 2);
        expect(innerPair).toBe(4);
      });

      test('handles multiple different paired tags', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'Hello' },
          { type: 'tag', content: '</bold>' },
          { type: 'text', content: ' ' },
          { type: 'tag', content: '<italic>' },
          { type: 'text', content: 'world' },
          { type: 'tag', content: '</italic>' }
        ];
        
        const boldOpeningPair = tagManager.findPairedTag(tokens, 0);
        expect(boldOpeningPair).toBe(2);
        
        const boldClosingPair = tagManager.findPairedTag(tokens, 2);
        expect(boldClosingPair).toBe(0);
        
        const italicOpeningPair = tagManager.findPairedTag(tokens, 4);
        expect(italicOpeningPair).toBe(6);
        
        const italicClosingPair = tagManager.findPairedTag(tokens, 6);
        expect(italicClosingPair).toBe(4);
      });

      test('returns undefined when opening tag has no closing tag', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'Hello world' }
        ];
        
        const pairedIndex = tagManager.findPairedTag(tokens, 0);
        
        expect(pairedIndex).toBeUndefined();
      });

      test('returns undefined when closing tag has no opening tag', () => {
        const tokens: Token[] = [
          { type: 'text', content: 'Hello world' },
          { type: 'tag', content: '</bold>' }
        ];
        
        const pairedIndex = tagManager.findPairedTag(tokens, 1);
        
        expect(pairedIndex).toBeUndefined();
      });

      test('handles mismatched tag names correctly', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'Hello' },
          { type: 'tag', content: '</italic>' }
        ];
        
        // <bold> should not pair with </italic>
        const pairedIndex = tagManager.findPairedTag(tokens, 0);
        
        expect(pairedIndex).toBeUndefined();
      });

      test('handles tags with hyphens in name', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<my-tag>' },
          { type: 'text', content: 'content' },
          { type: 'tag', content: '</my-tag>' }
        ];
        
        const pairedIndex = tagManager.findPairedTag(tokens, 0);
        
        expect(pairedIndex).toBe(2);
      });

      test('handles tags with underscores in name', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<my_tag>' },
          { type: 'text', content: 'content' },
          { type: 'tag', content: '</my_tag>' }
        ];
        
        const pairedIndex = tagManager.findPairedTag(tokens, 0);
        
        expect(pairedIndex).toBe(2);
      });

      test('handles tags with numbers in name', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<h1>' },
          { type: 'text', content: 'Heading' },
          { type: 'tag', content: '</h1>' }
        ];
        
        const pairedIndex = tagManager.findPairedTag(tokens, 0);
        
        expect(pairedIndex).toBe(2);
      });

      test('handles invalid index (negative)', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'Hello' },
          { type: 'tag', content: '</bold>' }
        ];
        
        const pairedIndex = tagManager.findPairedTag(tokens, -1);
        
        expect(pairedIndex).toBeUndefined();
      });

      test('handles invalid index (out of bounds)', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'Hello' },
          { type: 'tag', content: '</bold>' }
        ];
        
        const pairedIndex = tagManager.findPairedTag(tokens, 10);
        
        expect(pairedIndex).toBeUndefined();
      });

      test('handles non-tag token at index', () => {
        const tokens: Token[] = [
          { type: 'text', content: 'Hello' },
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'world' }
        ];
        
        const pairedIndex = tagManager.findPairedTag(tokens, 0);
        
        expect(pairedIndex).toBeUndefined();
      });

      test('handles empty token array', () => {
        const tokens: Token[] = [];
        
        const pairedIndex = tagManager.findPairedTag(tokens, 0);
        
        expect(pairedIndex).toBeUndefined();
      });

      test('handles complex nested structure with mixed tag types', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<div>' },
          { type: 'tag', content: '{1}' },
          { type: 'tag', content: '<span>' },
          { type: 'text', content: 'text' },
          { type: 'tag', content: '</span>' },
          { type: 'tag', content: '<br/>' },
          { type: 'tag', content: '</div>' }
        ];
        
        // <div> pairs with </div>
        expect(tagManager.findPairedTag(tokens, 0)).toBe(6);
        
        // {1} is standalone
        expect(tagManager.findPairedTag(tokens, 1)).toBeUndefined();
        
        // <span> pairs with </span>
        expect(tagManager.findPairedTag(tokens, 2)).toBe(4);
        
        // </span> pairs with <span>
        expect(tagManager.findPairedTag(tokens, 4)).toBe(2);
        
        // <br/> is standalone
        expect(tagManager.findPairedTag(tokens, 5)).toBeUndefined();
        
        // </div> pairs with <div>
        expect(tagManager.findPairedTag(tokens, 6)).toBe(0);
      });

      test('handles adjacent paired tags', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<b>' },
          { type: 'tag', content: '</b>' },
          { type: 'tag', content: '<i>' },
          { type: 'tag', content: '</i>' }
        ];
        
        expect(tagManager.findPairedTag(tokens, 0)).toBe(1);
        expect(tagManager.findPairedTag(tokens, 1)).toBe(0);
        expect(tagManager.findPairedTag(tokens, 2)).toBe(3);
        expect(tagManager.findPairedTag(tokens, 3)).toBe(2);
      });

      test('handles case-sensitive tag names', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<Bold>' },
          { type: 'text', content: 'text' },
          { type: 'tag', content: '</bold>' }
        ];
        
        // <Bold> should not pair with </bold> (different case)
        const pairedIndex = tagManager.findPairedTag(tokens, 0);
        
        expect(pairedIndex).toBeUndefined();
      });

      test('skips non-tag tokens when searching', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'Hello' },
          { type: 'text', content: ' ' },
          { type: 'text', content: 'world' },
          { type: 'tag', content: '</bold>' }
        ];
        
        const pairedIndex = tagManager.findPairedTag(tokens, 0);
        
        expect(pairedIndex).toBe(4);
      });
    });

    describe('copyTag()', () => {
      test('returns tag content string', () => {
        const tag: Token = {
          type: 'tag',
          content: '<bold>',
          meta: { id: '<bold>' }
        };
        
        const result = tagManager.copyTag(tag);
        
        expect(result).toBe('<bold>');
      });

      test('works with closing tags', () => {
        const tag: Token = {
          type: 'tag',
          content: '</bold>',
          meta: { id: '</bold>' }
        };
        
        const result = tagManager.copyTag(tag);
        
        expect(result).toBe('</bold>');
      });

      test('works with placeholder tags', () => {
        const tag: Token = {
          type: 'tag',
          content: '{1}',
          meta: { id: '{1}' }
        };
        
        const result = tagManager.copyTag(tag);
        
        expect(result).toBe('{1}');
      });

      test('works with self-closing tags', () => {
        const tag: Token = {
          type: 'tag',
          content: '<br/>',
          meta: { id: '<br/>' }
        };
        
        const result = tagManager.copyTag(tag);
        
        expect(result).toBe('<br/>');
      });

      test('works with printf-style tags', () => {
        const tag: Token = {
          type: 'tag',
          content: '%d',
          meta: { id: '%d' }
        };
        
        const result = tagManager.copyTag(tag);
        
        expect(result).toBe('%d');
      });
    });

    describe('getTagMetadata()', () => {
      test('returns complete metadata for paired opening tag', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'Hello' },
          { type: 'tag', content: '</bold>' }
        ];
        
        const metadata = tagManager.getTagMetadata(tokens[0], 0, tokens);
        
        expect(metadata).toEqual({
          index: 0,
          type: 'paired-start',
          pairedIndex: 2,
          isPaired: true,
          displayText: '[1',
          validationState: undefined
        });
      });

      test('returns complete metadata for paired closing tag', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'Hello' },
          { type: 'tag', content: '</bold>' }
        ];
        
        const metadata = tagManager.getTagMetadata(tokens[2], 2, tokens);
        
        expect(metadata).toEqual({
          index: 2,
          type: 'paired-end',
          pairedIndex: 0,
          isPaired: true,
          displayText: '3]',
          validationState: undefined
        });
      });

      test('returns complete metadata for standalone tag', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '{1}' },
          { type: 'text', content: 'Hello' }
        ];
        
        const metadata = tagManager.getTagMetadata(tokens[0], 0, tokens);
        
        expect(metadata).toEqual({
          index: 0,
          type: 'standalone',
          pairedIndex: undefined,
          isPaired: false,
          displayText: '⟨1⟩',
          validationState: undefined
        });
      });

      test('returns metadata with validation state when present', () => {
        const tokens: Token[] = [
          { 
            type: 'tag', 
            content: '<bold>',
            meta: { 
              id: '<bold>',
              validationState: 'error' as const
            }
          },
          { type: 'text', content: 'Hello' }
        ];
        
        const metadata = tagManager.getTagMetadata(tokens[0], 0, tokens);
        
        expect(metadata).toEqual({
          index: 0,
          type: 'paired-start',
          pairedIndex: undefined,
          isPaired: false,
          displayText: '[1',
          validationState: 'error'
        });
      });

      test('handles self-closing tags', () => {
        const tokens: Token[] = [
          { type: 'text', content: 'Line break' },
          { type: 'tag', content: '<br/>' },
          { type: 'text', content: 'here' }
        ];
        
        const metadata = tagManager.getTagMetadata(tokens[1], 1, tokens);
        
        expect(metadata).toEqual({
          index: 1,
          type: 'standalone',
          pairedIndex: undefined,
          isPaired: false,
          displayText: '⟨2⟩',
          validationState: undefined
        });
      });

      test('handles printf-style tags', () => {
        const tokens: Token[] = [
          { type: 'text', content: 'Count: ' },
          { type: 'tag', content: '%d' }
        ];
        
        const metadata = tagManager.getTagMetadata(tokens[1], 1, tokens);
        
        expect(metadata).toEqual({
          index: 1,
          type: 'standalone',
          pairedIndex: undefined,
          isPaired: false,
          displayText: '⟨2⟩',
          validationState: undefined
        });
      });

      test('handles nested paired tags correctly', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<b>' },
          { type: 'tag', content: '<i>' },
          { type: 'text', content: 'text' },
          { type: 'tag', content: '</i>' },
          { type: 'tag', content: '</b>' }
        ];
        
        // Outer opening tag should pair with outer closing tag
        const outerOpenMetadata = tagManager.getTagMetadata(tokens[0], 0, tokens);
        expect(outerOpenMetadata.pairedIndex).toBe(4);
        expect(outerOpenMetadata.isPaired).toBe(true);
        
        // Inner opening tag should pair with inner closing tag
        const innerOpenMetadata = tagManager.getTagMetadata(tokens[1], 1, tokens);
        expect(innerOpenMetadata.pairedIndex).toBe(3);
        expect(innerOpenMetadata.isPaired).toBe(true);
      });

      test('handles unpaired opening tag', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<bold>' },
          { type: 'text', content: 'Hello' }
        ];
        
        const metadata = tagManager.getTagMetadata(tokens[0], 0, tokens);
        
        expect(metadata).toEqual({
          index: 0,
          type: 'paired-start',
          pairedIndex: undefined,
          isPaired: false,
          displayText: '[1',
          validationState: undefined
        });
      });

      test('handles unpaired closing tag', () => {
        const tokens: Token[] = [
          { type: 'text', content: 'Hello' },
          { type: 'tag', content: '</bold>' }
        ];
        
        const metadata = tagManager.getTagMetadata(tokens[1], 1, tokens);
        
        expect(metadata).toEqual({
          index: 1,
          type: 'paired-end',
          pairedIndex: undefined,
          isPaired: false,
          displayText: '2]',
          validationState: undefined
        });
      });

      test('uses correct index for display text', () => {
        const tokens: Token[] = [
          { type: 'text', content: 'Start ' },
          { type: 'tag', content: '{1}' },
          { type: 'text', content: ' middle ' },
          { type: 'tag', content: '{2}' },
          { type: 'text', content: ' end' }
        ];
        
        const metadata1 = tagManager.getTagMetadata(tokens[1], 1, tokens);
        expect(metadata1.displayText).toBe('⟨1⟩');
        
        const metadata2 = tagManager.getTagMetadata(tokens[3], 3, tokens);
        expect(metadata2.displayText).toBe('⟨2⟩');
      });

      test('handles tag at high index', () => {
        const tokens: Token[] = Array(100).fill(null).map((_, i) => ({
          type: 'tag' as const,
          content: `{${i}}`
        }));
        
        const metadata = tagManager.getTagMetadata(tokens[99], 99, tokens);
        
        expect(metadata.index).toBe(99);
        expect(metadata.displayText).toBe('⟨99⟩');
      });

      test('combines display info and pairing info correctly', () => {
        const tokens: Token[] = [
          { type: 'tag', content: '<span>' },
          { type: 'text', content: 'Content' },
          { type: 'tag', content: '</span>' }
        ];
        
        const metadata = tagManager.getTagMetadata(tokens[0], 0, tokens);
        
        // Should have display info from getTagDisplayInfo
        expect(metadata.displayText).toBe('[1');
        expect(metadata.type).toBe('paired-start');
        
        // Should have pairing info from findPairedTag
        expect(metadata.pairedIndex).toBe(2);
        expect(metadata.isPaired).toBe(true);
        
        // Should have the index
        expect(metadata.index).toBe(0);
      });

      test('handles multiple validation states', () => {
        const tokens: Token[] = [
          { 
            type: 'tag', 
            content: '<bold>',
            meta: { validationState: 'warning' as const }
          },
          { 
            type: 'tag', 
            content: '</bold>',
            meta: { validationState: 'valid' as const }
          }
        ];
        
        const metadata1 = tagManager.getTagMetadata(tokens[0], 0, tokens);
        expect(metadata1.validationState).toBe('warning');
        
        const metadata2 = tagManager.getTagMetadata(tokens[1], 1, tokens);
        expect(metadata2.validationState).toBe('valid');
      });
    });
  });
});
