-- Distributed Free Association Implementation
-- Using Transient-Universe for distributed computing
-- Build with: cabal install transient-universe

{-# LANGUAGE DeriveGeneric, DeriveDataTypeable, FlexibleContexts #-}

module FreeAssociation where

import Transient.Base
import Transient.Move
import Transient.Indeterminism
import Transient.Logged
import Transient.EventStore
import Transient.FastLogger

import Data.Typeable
import Data.Binary
import Data.Map (Map)
import qualified Data.Map as Map
import Data.Set (Set)
import qualified Data.Set as Set
import Data.List
import Data.Maybe
import Control.Monad
import Control.Monad.IO.Class
import Control.Applicative
import Control.Concurrent
import GHC.Generics
import System.IO
import System.Random
import Data.IORef
import Data.Time

-- Core Types for Free Association
type PersonId = String
type Recognition = Float  -- Recognition value between 0.0 and 1.0

-- Basic datatypes must be serializable for network distribution
data Person = Person {
    personId :: PersonId,
    personName :: String,
    nodeAddress :: String  -- Network address for this person's node
} deriving (Show, Read, Eq, Ord, Typeable, Generic)

instance Binary Person

-- Recognition record represents one person's recognition of another
data RecognitionRecord = RecognitionRecord {
    recognizer :: PersonId,
    recognized :: PersonId,
    recognitionValue :: Recognition,
    lastUpdated :: UTCTime
} deriving (Show, Read, Eq, Typeable, Generic)

instance Binary RecognitionRecord

-- Mutual Recognition between two people
data MutualRecognition = MutualRecognition {
    person1 :: PersonId,
    person2 :: PersonId,
    mutualValue :: Recognition,
    calculatedAt :: UTCTime
} deriving (Show, Read, Eq, Typeable, Generic)

instance Binary MutualRecognition

-- Resource/Surplus record
data Resource = Resource {
    resourceId :: String,
    resourceName :: String,
    resourceOwner :: PersonId,
    resourceDescription :: String,
    resourceQuantity :: Float,
    resourceTags :: [String]
} deriving (Show, Read, Eq, Typeable, Generic)

instance Binary Resource

-- A distribution of a resource to someone
data ResourceDistribution = ResourceDistribution {
    distributionId :: String,
    resource :: Resource,
    fromPerson :: PersonId,
    toPerson :: PersonId,
    distributionAmount :: Float,
    distributionReason :: String,
    distributionTimestamp :: UTCTime
} deriving (Show, Read, Eq, Typeable, Generic)

instance Binary ResourceDistribution

-- Network configuration
data NetworkNode = NetworkNode {
    nodeId :: PersonId,
    nodePerson :: Person,
    nodeRecognitionsRef :: IORef (Map PersonId Recognition),
    nodeResourcesRef :: IORef [Resource],
    nodeDistributionsRef :: IORef [ResourceDistribution],
    nodeKnownPeersRef :: IORef (Set PersonId),
    nodeMutualRecognitionsRef :: IORef (Map PersonId MutualRecognition)
} deriving (Typeable)

-- Network events for distribution
data NetworkEvent = 
    RecognitionUpdate RecognitionRecord
  | ResourceAnnouncement Resource
  | ResourceDistributionEvent ResourceDistribution
  | PeerDiscovery PersonId String  -- PersonId and network address
  | RequestMutualRecognition PersonId PersonId
  | MutualRecognitionResponse MutualRecognition
  deriving (Show, Read, Eq, Typeable, Generic)

instance Binary NetworkEvent

-- Initialize a new node in the network
initNode :: Person -> IO NetworkNode
initNode person = do
    recognitionsRef <- newIORef Map.empty
    resourcesRef <- newIORef []
    distributionsRef <- newIORef []
    knownPeersRef <- newIORef Set.empty
    mutualRecognitionsRef <- newIORef Map.empty
    return $ NetworkNode {
        nodeId = personId person,
        nodePerson = person,
        nodeRecognitionsRef = recognitionsRef,
        nodeResourcesRef = resourcesRef,
        nodeDistributionsRef = distributionsRef,
        nodeKnownPeersRef = knownPeersRef,
        nodeMutualRecognitionsRef = mutualRecognitionsRef
    }

-- Start a node in the distributed network
runNode :: NetworkNode -> String -> Int -> [String] -> IO ()
runNode node host port seedNodes = do
    putStrLn $ "Starting node for " ++ personName (nodePerson node) ++ " at " ++ host ++ ":" ++ show port
    keep' $ initNode' port $ \ myPort -> do
        -- Connect to seed nodes if provided
        when (not $ null seedNodes) $ do
            liftIO $ putStrLn "Connecting to seed nodes..."
            forM_ seedNodes $ \seedNode -> do
                connectToNode seedNode

        -- Announce ourselves to the network
        liftIO $ putStrLn "Announcing to network..."
        let myAddress = host ++ ":" ++ show myPort
        -- Update our node's address
        let updatedPerson = (nodePerson node) { nodeAddress = myAddress }
        liftIO $ atomicModifyIORef' (nodeKnownPeersRef node) $ \peers -> 
            (Set.insert (personId updatedPerson) peers, ())

        -- Start handling network events
        fork $ handleNetworkEvents node
        
        -- Start a simple REPL for interacting with the node
        nodeREPL node
  where
    connectToNode :: String -> Cloud ()
    connectToNode addr = do
        liftIO $ putStrLn $ "Connecting to " ++ addr
        r <- connect (http addr) $ return "Connected"
        liftIO $ putStrLn r
        return ()

-- Handle all incoming network events
handleNetworkEvents :: NetworkNode -> Cloud ()
handleNetworkEvents node = do
    liftIO $ putStrLn "Listening for network events..."
    
    -- Listen for all types of events
    event <- subscribe
    
    liftIO $ putStrLn $ "Received event: " ++ show event
    
    -- Handle the event based on its type
    case event of
        RecognitionUpdate record -> do
            handleRecognitionUpdate node record
            
        ResourceAnnouncement resource -> do
            handleResourceAnnouncement node resource
            
        ResourceDistributionEvent distribution -> do
            handleResourceDistribution node distribution
            
        PeerDiscovery peerId address -> do
            handlePeerDiscovery node peerId address
            
        RequestMutualRecognition p1 p2 -> do
            handleMutualRecognitionRequest node p1 p2
            
        MutualRecognitionResponse mutualRec -> do
            handleMutualRecognitionResponse node mutualRec
    
    -- Continue listening for events
    handleNetworkEvents node

-- Handle an incoming recognition update
handleRecognitionUpdate :: NetworkNode -> RecognitionRecord -> Cloud ()
handleRecognitionUpdate node record = do
    -- Only process if we're the recognized person or the recognizer
    when (recognized record == nodeId node || recognizer record == nodeId node) $ do
        liftIO $ putStrLn $ "Processing recognition update: " ++ show record
        
        -- If we're the recognizer, update our local recognition
        when (recognizer record == nodeId node) $ do
            liftIO $ atomicModifyIORef' (nodeRecognitionsRef node) $ \recs ->
                (Map.insert (recognized record) (recognitionValue record) recs, ())
            
        -- If we're being recognized, we should check for mutual recognition
        when (recognized record == nodeId node) $ do
            -- Get our recognition of the other person
            myRecs <- liftIO $ readIORef (nodeRecognitionsRef node)
            let myRecognition = Map.lookup (recognizer record) myRecs
            
            -- If we have mutual recognition, calculate it and store it
            case myRecognition of
                Just myValue -> do
                    now <- liftIO getCurrentTime
                    let mutualValue = min myValue (recognitionValue record)
                    let mutualRec = MutualRecognition {
                        person1 = nodeId node,
                        person2 = recognizer record,
                        mutualValue = mutualValue,
                        calculatedAt = now
                    }
                    
                    liftIO $ atomicModifyIORef' (nodeMutualRecognitionsRef node) $ \mutuals ->
                        (Map.insert (recognizer record) mutualRec mutuals, ())
                    
                    liftIO $ putStrLn $ "Calculated mutual recognition: " ++ show mutualValue
                    
                    -- Inform the other person of our mutual recognition
                    async $ callTo (nodeAddress (nodePerson node)) $ 
                        publish $ MutualRecognitionResponse mutualRec
                
                Nothing -> 
                    liftIO $ putStrLn "No mutual recognition yet (we don't recognize them)"

-- Handle resource announcements
handleResourceAnnouncement :: NetworkNode -> Resource -> Cloud ()
handleResourceAnnouncement node resource = do
    liftIO $ putStrLn $ "New resource available: " ++ resourceName resource
    
    -- Store the resource if it's relevant to us (from someone we recognize)
    myRecs <- liftIO $ readIORef (nodeRecognitionsRef node)
    when (Map.member (resourceOwner resource) myRecs) $ do
        liftIO $ atomicModifyIORef' (nodeResourcesRef node) $ \res ->
            (resource : res, ())
        liftIO $ putStrLn "Resource added to our known resources"

-- Handle resource distributions
handleResourceDistribution :: NetworkNode -> ResourceDistribution -> Cloud ()
handleResourceDistribution node distribution = do
    -- If we're receiving a resource
    when (toPerson distribution == nodeId node) $ do
        liftIO $ putStrLn $ "Receiving resource: " ++ resourceName (resource distribution)
        liftIO $ atomicModifyIORef' (nodeDistributionsRef node) $ \dists ->
            (distribution : dists, ())
    
    -- If we're distributing a resource
    when (fromPerson distribution == nodeId node) $ do
        liftIO $ putStrLn $ "Distributing resource: " ++ resourceName (resource distribution)
        liftIO $ atomicModifyIORef' (nodeDistributionsRef node) $ \dists ->
            (distribution : dists, ())

-- Handle peer discovery
handlePeerDiscovery :: NetworkNode -> PersonId -> String -> Cloud ()
handlePeerDiscovery node peerId address = do
    liftIO $ putStrLn $ "Discovered peer: " ++ peerId ++ " at " ++ address
    
    -- Add to known peers
    liftIO $ atomicModifyIORef' (nodeKnownPeersRef node) $ \peers ->
        (Set.insert peerId peers, ())
    
    -- Request mutual recognition if we have recognition for them
    myRecs <- liftIO $ readIORef (nodeRecognitionsRef node)
    when (Map.member peerId myRecs) $ do
        liftIO $ putStrLn "Requesting mutual recognition with new peer"
        async $ callTo address $ publish $ RequestMutualRecognition (nodeId node) peerId

-- Handle a request for mutual recognition
handleMutualRecognitionRequest :: NetworkNode -> PersonId -> PersonId -> Cloud ()
handleMutualRecognitionRequest node requesterId targetId = do
    -- Only respond if we're the target
    when (targetId == nodeId node) $ do
        liftIO $ putStrLn $ "Received mutual recognition request from: " ++ requesterId
        
        -- Check if we recognize the requester
        myRecs <- liftIO $ readIORef (nodeRecognitionsRef node)
        case Map.lookup requesterId myRecs of
            Just myValue -> do
                -- We recognize them, so create a recognition record to send back
                now <- liftIO getCurrentTime
                let record = RecognitionRecord {
                    recognizer = nodeId node,
                    recognized = requesterId,
                    recognitionValue = myValue,
                    lastUpdated = now
                }
                
                -- Find their address
                peers <- liftIO $ readIORef (nodeKnownPeersRef node)
                -- In a real implementation, we would have a mapping of peer IDs to addresses
                -- For now, we assume we can derive it or have it stored
                -- let peerAddress = getPeerAddress requesterId
                
                -- Send our recognition to them
                -- async $ callTo peerAddress $ publish $ RecognitionUpdate record
                
                liftIO $ putStrLn "Sent our recognition back to requester"
                
            Nothing ->
                liftIO $ putStrLn "We don't recognize the requester"

-- Handle a mutual recognition response
handleMutualRecognitionResponse :: NetworkNode -> MutualRecognition -> Cloud ()
handleMutualRecognitionResponse node mutualRec = do
    -- Only process if we're involved in this mutual recognition
    when (person1 mutualRec == nodeId node || person2 mutualRec == nodeId node) $ do
        liftIO $ putStrLn $ "Received mutual recognition: " ++ show mutualRec
        
        -- Store the mutual recognition
        let otherPerson = if person1 mutualRec == nodeId node then person2 mutualRec else person1 mutualRec
        liftIO $ atomicModifyIORef' (nodeMutualRecognitionsRef node) $ \mutuals ->
            (Map.insert otherPerson mutualRec mutuals, ())
        
        liftIO $ putStrLn $ "Mutual recognition with " ++ otherPerson ++ " = " ++ show (mutualValue mutualRec)

-- Calculate one person's share in another's surplus
calculateSurplusShare :: NetworkNode -> PersonId -> Cloud Recognition
calculateSurplusShare node providerId = do
    -- Get all mutual recognitions
    mutuals <- liftIO $ readIORef (nodeMutualRecognitionsRef node)
    
    -- Find our mutual recognition with the provider
    let ourMutual = Map.lookup providerId mutuals
    
    -- Calculate total mutual recognition for this provider
    -- In a distributed system, we would need to query this information
    -- This is a simplified version
    let totalMutualValues = sum $ map mutualValue $ Map.elems mutuals
    
    -- Calculate our share
    return $ case ourMutual of
        Just mutual -> if totalMutualValues == 0 then 0 else mutualValue mutual / totalMutualValues
        Nothing -> 0

-- Distribute resources based on mutual recognition
distributeResources :: NetworkNode -> Cloud ()
distributeResources node = do
    -- Get our resources
    resources <- liftIO $ readIORef (nodeResourcesRef node)
    
    -- Get our mutual recognitions
    mutuals <- liftIO $ readIORef (nodeMutualRecognitionsRef node)
    
    -- Calculate total mutual recognition
    let totalMutual = sum $ map mutualValue $ Map.elems mutuals
    
    -- Only distribute if we have mutual recognitions
    when (totalMutual > 0) $ do
        -- For each resource
        forM_ resources $ \resource -> do
            -- For each person we have mutual recognition with
            forM_ (Map.assocs mutuals) $ \(personId, mutual) -> do
                -- Calculate their share
                let share = mutualValue mutual / totalMutual
                let distributionAmount = share * resourceQuantity resource
                
                when (distributionAmount > 0) $ do
                    -- Create a distribution record
                    now <- liftIO getCurrentTime
                    let distribution = ResourceDistribution {
                        distributionId = show now ++ "_" ++ resourceId resource ++ "_" ++ personId,
                        resource = resource { resourceQuantity = distributionAmount },
                        fromPerson = nodeId node,
                        toPerson = personId,
                        distributionAmount = distributionAmount,
                        distributionReason = "Mutual recognition distribution",
                        distributionTimestamp = now
                    }
                    
                    -- Publish the distribution
                    liftIO $ putStrLn $ "Distributing " ++ show distributionAmount ++ " of " 
                                      ++ resourceName resource ++ " to " ++ personId
                    publish $ ResourceDistributionEvent distribution

-- A simple REPL for interacting with the node
nodeREPL :: NetworkNode -> Cloud ()
nodeREPL node = do
    liftIO $ putStrLn $ "\n==== Free Association Node: " ++ personName (nodePerson node) ++ " ===="
    liftIO $ putStrLn "Commands:"
    liftIO $ putStrLn "  recognize <person-id> <value>  - Set your recognition for someone"
    liftIO $ putStrLn "  addResource <name> <quantity>  - Add a new resource you control"
    liftIO $ putStrLn "  distribute                    - Distribute your resources according to mutual recognition"
    liftIO $ putStrLn "  showRecognitions              - Show your recognitions of others"
    liftIO $ putStrLn "  showMutual                    - Show mutual recognitions"
    liftIO $ putStrLn "  showResources                 - Show available resources"
    liftIO $ putStrLn "  showDistributions             - Show resource distributions"
    liftIO $ putStrLn "  quit                          - Exit the program"
    liftIO $ putStr "> "
    liftIO $ hFlush stdout
    
    cmd <- liftIO getLine
    let parts = words cmd
    
    case parts of
        ["recognize", pid, valStr] -> do
            let val = read valStr :: Recognition
            now <- liftIO getCurrentTime
            let record = RecognitionRecord {
                recognizer = nodeId node,
                recognized = pid,
                recognitionValue = val,
                lastUpdated = now
            }
            
            -- Update local recognition
            liftIO $ atomicModifyIORef' (nodeRecognitionsRef node) $ \recs ->
                (Map.insert pid val recs, ())
            
            -- Publish the update
            publish $ RecognitionUpdate record
            liftIO $ putStrLn $ "Recognition for " ++ pid ++ " set to " ++ show val
            
        ["addResource", name, qtyStr] -> do
            let qty = read qtyStr :: Float
            now <- liftIO getCurrentTime
            let resourceId = personId (nodePerson node) ++ "_" ++ name ++ "_" ++ show now
            let resource = Resource {
                resourceId = resourceId,
                resourceName = name,
                resourceOwner = nodeId node,
                resourceDescription = "Resource added by " ++ personName (nodePerson node),
                resourceQuantity = qty,
                resourceTags = []
            }
            
            -- Add to local resources
            liftIO $ atomicModifyIORef' (nodeResourcesRef node) $ \res ->
                (resource : res, ())
            
            -- Announce the resource
            publish $ ResourceAnnouncement resource
            liftIO $ putStrLn $ "Added resource: " ++ name ++ " with quantity " ++ show qty
            
        ["distribute"] -> do
            distributeResources node
            liftIO $ putStrLn "Resources distributed according to mutual recognition"
            
        ["showRecognitions"] -> do
            recs <- liftIO $ readIORef (nodeRecognitionsRef node)
            liftIO $ putStrLn "Your recognitions:"
            forM_ (Map.assocs recs) $ \(pid, val) -> do
                liftIO $ putStrLn $ "  " ++ pid ++ ": " ++ show val
                
        ["showMutual"] -> do
            mutuals <- liftIO $ readIORef (nodeMutualRecognitionsRef node)
            liftIO $ putStrLn "Mutual recognitions:"
            forM_ (Map.assocs mutuals) $ \(pid, mutual) -> do
                liftIO $ putStrLn $ "  " ++ pid ++ ": " ++ show (mutualValue mutual)
                
        ["showResources"] -> do
            resources <- liftIO $ readIORef (nodeResourcesRef node)
            liftIO $ putStrLn "Available resources:"
            forM_ resources $ \res -> do
                liftIO $ putStrLn $ "  " ++ resourceName res ++ ": " ++ show (resourceQuantity res)
                
        ["showDistributions"] -> do
            distributions <- liftIO $ readIORef (nodeDistributionsRef node)
            liftIO $ putStrLn "Resource distributions:"
            forM_ distributions $ \dist -> do
                liftIO $ putStrLn $ "  " ++ fromPerson dist ++ " -> " ++ toPerson dist 
                                   ++ ": " ++ resourceName (resource dist) 
                                   ++ " (" ++ show (distributionAmount dist) ++ ")"
                
        ["quit"] -> do
            liftIO $ putStrLn "Exiting..."
            exit
            
        _ -> do
            liftIO $ putStrLn "Unknown command"
    
    -- Continue REPL
    nodeREPL node

-- Main function to start a node
main :: IO ()
main = do
    putStrLn "Free Association Distributed Network"
    putStrLn "-----------------------------------"
    putStrLn "Enter your details:"
    putStr "Your ID: "
    hFlush stdout
    pid <- getLine
    putStr "Your Name: "
    hFlush stdout
    name <- getLine
    putStr "Host (default: localhost): "
    hFlush stdout
    host <- getLine
    let hostAddr = if null host then "localhost" else host
    putStr "Port: "
    hFlush stdout
    portStr <- getLine
    let port = read portStr :: Int
    
    putStr "Seed nodes (comma separated, leave empty for none): "
    hFlush stdout
    seedsStr <- getLine
    let seeds = if null seedsStr then [] else words $ map (\c -> if c == ',' then ' ' else c) seedsStr
    
    let person = Person {
        personId = pid,
        personName = name,
        nodeAddress = hostAddr ++ ":" ++ show port
    }
    
    -- Initialize and run the node
    node <- initNode person
    runNode node hostAddr port seeds

-- Example of how to run a small network locally for testing
runTestNetwork :: IO ()
runTestNetwork = do
    -- Create three test persons
    let alice = Person "alice" "Alice" "localhost:8000"
    let bob = Person "bob" "Bob" "localhost:8001"
    let charlie = Person "charlie" "Charlie" "localhost:8002"
    
    -- Initialize their nodes
    aliceNode <- initNode alice
    bobNode <- initNode bob
    charlieNode <- initNode charlie
    
    -- Start them in separate threads
    forkIO $ runNode aliceNode "localhost" 8000 []
    threadDelay 1000000  -- Wait a second for Alice to start
    
    forkIO $ runNode bobNode "localhost" 8001 ["localhost:8000"]
    threadDelay 1000000  -- Wait a second for Bob to start
    
    runNode charlieNode "localhost" 8002 ["localhost:8000", "localhost:8001"]

-- Helper functions for real-world usage

-- Normalize a set of recognitions to ensure they sum to 1.0
normalizeRecognitions :: Map PersonId Recognition -> Map PersonId Recognition
normalizeRecognitions recognitions =
    let total = sum $ Map.elems recognitions
    in if total > 0
       then Map.map (\r -> r / total) recognitions
       else recognitions

-- Find paths between two people in the network (for six degrees implementation)
findPaths :: PersonId -> PersonId -> Int -> Cloud [[PersonId]]
findPaths start end maxDepth = do
    -- This would need to be implemented using distributed queries
    -- For now, return a placeholder
    return []

-- Calculate the impact of false recognition on self-actualization
calculateFalseRecognitionImpact :: Recognition -> Recognition -> Recognition
calculateFalseRecognitionImpact falseRecognition realContributorBase =
    let realRecognitionRemaining = 1.0 - falseRecognition
        mutualWithRealContributors = min realRecognitionRemaining realContributorBase
        surplusFromRealContributors = mutualWithRealContributors / realContributorBase
        selfActualizationCapacity = surplusFromRealContributors * realContributorBase
    in selfActualizationCapacity