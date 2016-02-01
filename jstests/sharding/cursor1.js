// cursor1.js
// checks that cursors survive a chunk's move
(function() {

var s = new ShardingTest({ name: "sharding_cursor1", shards: 2 });
s.config.settings.find().forEach( printjson )

// create a sharded 'test.foo', for the moment with just one chunk
s.adminCommand( { enablesharding: "test" } );
s.ensurePrimaryShard('test', 'shard0001');
s.adminCommand( { shardcollection: "test.foo", key: { _id: 1 } } )

db = s.getDB( "test" );
primary = s.getServer( "test" ).getDB( "test" );
secondary = s.getOther( primary ).getDB( "test" );

numObjs = 10;
var bulk = db.foo.initializeUnorderedBulkOp();
for (i=0; i < numObjs; i++){
    bulk.insert({ _id: i });
}
assert.writeOK(bulk.execute());
assert.eq( 1, s.config.chunks.count() , "test requires collection to have one chunk initially" );

// we'll split the collection in two and move the second chunk while three cursors are open
// cursor1 still has more data in the first chunk, the one that didn't move
// cursor2 buffered the last obj of the first chunk
// cursor3 buffered data that was moved on the second chunk
var cursor1 = db.foo.find().batchSize( 3 );
assert.eq( 3 , cursor1.objsLeftInBatch() );
var cursor2 = db.foo.find().batchSize( 5 );
assert.eq( 5 , cursor2.objsLeftInBatch() );
var cursor3 = db.foo.find().batchSize( 7 );
assert.eq( 7 , cursor3.objsLeftInBatch() );

s.adminCommand( { split: "test.foo" , middle : { _id : 5 } } );
s.adminCommand( { movechunk : "test.foo" , find : { _id : 5 } , to : secondary.getMongo().name } );
assert.eq( 2, s.config.chunks.count() );

// the cursors should not have been affected
assert.eq( numObjs , cursor1.itcount() , "c1" );
assert.eq( numObjs , cursor2.itcount() , "c2" );
assert.eq( numObjs , cursor3.itcount() , "c3" );

// test timeout
gc(); gc();
cur = db.foo.find().batchSize( 2 )
assert( cur.next() , "T1" )
assert( cur.next() , "T2" );
assert.commandWorked(s.admin.runCommand({
    setParameter: 1,
    cursorTimeoutMillis: 10000 // 10 seconds.
}));
before = db.serverStatus().metrics.cursor;
printjson( before )
sleep( 6000 )
assert( cur.next() , "T3" )
assert( cur.next() , "T4" );
sleep( 24000 )
assert.throws( function(){ cur.next(); } , null , "T5" )
after = db.serverStatus().metrics.cursor;
gc(); gc()

s.stop();

})();
